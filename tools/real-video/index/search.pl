#!/usr/bin/env perl
# Find real video clips in the private caption index (collect.pl fills it on his PC), printed like captionsearch.pl:
#   perl tools/real-video/index/search.pl "what do you mean" [how many, default 10] [options]
# For each match: the channel and video title, a YouTube link with the time (paste it in the clip page's "add a
# clip"), the exact start and end of the line (and of the words themselves where YouTube gave word times), the
# caption kind, whether the video is still online, and the line with two lines before and after it, with times.
#
# What to search:
#   "what do you mean"                  the exact words, in this order (punctuation and case don't matter)
#   "what do you mean | what did you mean"   any of these
#   "call ~3 back"                      both, at most 3 words apart, either order ("call you back", "call me back";
#                                       plain ~ = 10 words)
#   "tire*"                             a word starting with this (tired, tiring)
# Options:
#   --page 2        the next results (as many as asked for, default 10; no limit)
#   --human         only uploaded (human) captions: their text is exact; auto-captions can mishear
#   --channel office,friends   only these channels (part of the name is enough); --not snl,colbert leaves them out
#   --all           also videos that can't be embedded or were found gone (the clip page can't play them)
#   --no-check      skip the online check (YouTube oEmbed: 200 = online, 404 = gone, 401/403 = private or no embed)
#   --channels      the channels in the index and how many of their videos are searchable
#   --clip          under each result, its clip entry for docs/real-video/words/<word>.json (v, s, e, line, an empty
#                   note, around = one line before and after), ready to paste once the clip is watched
# One result per video (the best line; "+2 more" says how many others it has), channels taken in turn, short lines
# first. A scene found in several videos (a compilation and its own clip) is shown once, human captions first, and
# "same scene also in …" names the other videos (use one of them if this one goes offline).
# Then watch each clip in the clip page before choosing it, as CLAUDE.md says.
#
# The index is private (YouTube's terms don't allow downloading captions; he chose this for his own use): never put
# what it prints into this repo, a page or a commit, except the few clip lines saved in docs/real-video/words/.
use strict; use warnings; use utf8;
# This script's folder, also when started as C:...llect.pl (FindBin gets that wrong in Git Bash's Perl).
our $BIN; BEGIN { ($BIN = __FILE__) =~ tr{\\}{/}; $BIN =~ s{/[^/]*$}{} or $BIN = '.'; unshift @INC, $BIN }
use CaptionIndex;
use List::Util qw(min max first); use JSON::PP;
binmode STDOUT, ':encoding(UTF-8)'; binmode STDERR, ':encoding(UTF-8)';

my (%opt, @args);
@ARGV = map { my $x = $_; utf8::decode($x); $x } @ARGV;
while (@ARGV) {
  my $arg = shift @ARGV;
  if ($arg =~ /^--(page|channel|not)$/) { push @{$opt{$1}}, shift @ARGV }
  elsif ($arg =~ /^--(page|channel|not)=(.*)$/) { push @{$opt{$1}}, $2 }
  elsif ($arg =~ /^--(human|all|no-check|channels|clip|help)$/) { $opt{$1} = 1 }
  elsif ($arg =~ /^--/) { die "unknown option $arg (see the top of $0)\n" }
  else { push @args, $arg }
}
my $db = db_path();
die "No caption index yet ($db). Start the collector: perl tools/real-video/index/collect.pl --install\n" unless -e $db;
if ($opt{channels}) { list_channels(); exit }
my ($query, $limit) = @args;
die "usage: perl tools/real-video/index/search.pl \"phrase\" [how many] [--page N] [--human] [--channel x,y] [--not x] [--all] [--no-check]\n"
  unless defined $query && $query =~ /\S/;
$limit = 10 unless defined $limit && $limit =~ /^\d+$/ && $limit > 0;
my $page = ($opt{page} && $opt{page}[-1] =~ /^\d+$/) ? max(1, $opt{page}[-1]) : 1;

# ---- the query ------------------------------------------------------------------------------------------------

# A phrase = [[word, is prefix], …]; an alternative = {phrases => [...], near => N or undef}.
sub phrase_tokens {
  my @t;
  for my $w (split ' ', shift) {
    my $pre = $w =~ s/\*+$//;
    my @x = tokens($w);
    push @t, map { [$_, 0] } @x;
    $t[-1][1] = 1 if $pre && @x;
  }
  \@t;
}
my @alts;
for my $alt (split /\s*\|\s*|\s+OR\s+/, $query) {
  my @parts = split /\s*~(\d*)\s*/, $alt;
  my (@ph, $near);
  while (@parts) {
    my $p = phrase_tokens(shift @parts);
    push @ph, $p if @$p;
    if (@parts) { my $n = shift @parts; $near = max($near // 0, length $n ? $n : 10) }
  }
  next unless @ph;
  push @alts, {phrases => \@ph, near => (@ph > 1 ? $near // 10 : undef)};
}
die "Nothing to search in \"$query\".\n" unless @alts;

# FTS5 can't put a prefix word in the middle of a phrase: such a phrase is split, and the exact check below decides.
sub fts_parts {
  my (@parts, @cur);
  for my $x (@{shift()}) { push @cur, $x; if ($x->[1]) { push @parts, [@cur]; @cur = () } }
  push @parts, [@cur] if @cur;
  map { my $p = $_; '"' . join(' ', map { $_->[0] } @$p) . '"' . ($p->[-1][1] ? '*' : '') } @parts;
}
my $fts = join ' OR ', map {
  my $q = $_;
  if (!$q->{near}) { '(' . join(' AND ', fts_parts($q->{phrases}[0])) . ')' }
  else {
    my $extra = 0; $extra += @$_ for @{$q->{phrases}};
    'NEAR(' . join(' ', map { fts_parts($_) } @{$q->{phrases}}) . ', ' . ($q->{near} + $extra) . ')';
  }
} @alts;
my $shown = join ' | ', map { my $q = $_; join($q->{near} ? " ~$q->{near} " : ' ', map { join ' ', map { $_->[0] . ($_->[1] ? '*' : '') } @$_ } @{$q->{phrases}}) } @alts;

# ---- candidates -----------------------------------------------------------------------------------------------

my @where = ("v.status='done'");
push @where, "v.kind='human'" if $opt{human};
push @where, "(v.embed IS NULL OR v.embed=1)", "(v.alive IS NULL OR v.alive=200)" unless $opt{all};
my $chan = sub {
  my @n = map { my $x = lc; $x =~ s/'/''/g; $x =~ s/[%_]//g; $x } grep { length } map { split /\s*,\s*/ } @_;
  join ' OR ', map { "lower(ifnull(c.name,'')) LIKE '%$_%' OR lower(ifnull(c.handle,'')) LIKE '%$_%' OR v.channel LIKE '%$_%'" } @n;
};
push @where, '(' . $chan->(@{$opt{channel}}) . ')' if $opt{channel} && $chan->(@{$opt{channel}});
push @where, 'NOT (' . $chan->(@{$opt{not}}) . ')' if $opt{not} && $chan->(@{$opt{not}});
(my $ftsq = $fts) =~ s/'/''/g;
my @rows = sql(<<"SQL");
SELECT l.id, l.s, l.e, l.text, ifnull(l.w,''), ifnull(n.text,''), ifnull(n.e,''), ifnull(n.w,''), ifnull(n.s,''),
  v.k, v.id, ifnull(v.title,''), ifnull(v.views,0), ifnull(v.kind,''), ifnull(v.alive,''), ifnull(v.checked_at,0),
  v.channel, ifnull(c.name, v.channel)
FROM win JOIN lines l ON l.id = win.rowid JOIN videos v ON v.k = l.id / 100000
LEFT JOIN channels c ON c.key = v.channel LEFT JOIN lines n ON n.id = l.id + 1
WHERE win MATCH '$ftsq' AND @{[join ' AND ', @where]}
LIMIT 50000;
SQL
my ($indexed) = map { $_->[0] } sql("SELECT count(*) FROM videos WHERE status='done';");

# ---- exact matches --------------------------------------------------------------------------------------------

sub line_tokens {   # [token, word number] for each token of a line
  my @t; my $wi = 0;
  for my $w (split ' ', shift) { push @t, [$_, $wi] for tokens($w); $wi++ }
  @t;
}
sub occurrences {
  my ($T, $p) = @_;
  my @o;
  POS: for my $i (0 .. @$T - @$p) {
    for my $j (0 .. $#$p) {
      my ($q, $pre) = @{$p->[$j]};
      my $t = $T->[$i + $j][0];
      next POS unless $pre ? index($t, $q) == 0 : $t eq $q;
    }
    push @o, [$i, $i + $#$p];
  }
  @o;
}
# Each match as [first token, last token] in the line and the next one; only matches that start in the line count
# (the next line's own row finds the ones that start there).
sub matches {
  my ($T, $n0) = @_;
  my @m;
  for my $alt (@alts) {
    my @occ = map { [occurrences($T, $_)] } @{$alt->{phrases}};
    if (!$alt->{near}) { push @m, @{$occ[0]}; next }
    next if grep { !@$_ } @occ;
    for my $o (@{$occ[0]}) {
      my @pick = ($o);
      for my $k (1 .. $#occ) {
        my ($best) = sort { abs($a->[0] - $o->[0]) <=> abs($b->[0] - $o->[0]) }
          grep { $_->[1] < $o->[0] || $_->[0] > $o->[1] } @{$occ[$k]};
        unless ($best) { @pick = (); last }
        push @pick, $best;
      }
      next unless @pick;
      my @s = sort { $a->[0] <=> $b->[0] } @pick;
      my $between = $s[-1][0] - max(map { $_->[1] } @s[0 .. $#s - 1]) - 1;
      push @m, [min(map { $_->[0] } @s), max(map { $_->[1] } @s)] if $between <= $alt->{near};
    }
  }
  my %seen;
  grep { $_->[0] < $n0 && !$seen{"$_->[0]"}++ } sort { $a->[0] <=> $b->[0] } @m;
}

my %video;
for my $r (@rows) {
  my ($lid, $s, $e, $text, $w, $ntext, $ne, $nw, $ns, $k, $vid, $title, $views, $kind, $alive, $checked, $ckey, $cname) = @$r;
  my @t1 = line_tokens($text);
  my @t2 = map { [$_->[0], $_->[1], 1] } line_tokens($ntext);
  my @T = ((map { [@$_, 0] } @t1), @t2);
  for my $m (matches(\@T, scalar @t1)) {
    my $spans = $T[$m->[1]][2];
    my $words = scalar(() = $text =~ /\S+/g);
    my $score = $words + ($spans ? 4 : 0) + ($kind eq 'auto' ? 1 : 0);
    # The words' own times, where the captions have them: first word's start to the next word's start.
    my ($ws, $we);
    my @off1 = split ' ', $w; my @off2 = split ' ', $nw;
    my ($fw, $lw) = ($T[$m->[0]][1], $T[$m->[1]]);
    if (@off1 && defined $off1[$fw]) {
      $ws = $s + $off1[$fw];
      if (!$lw->[2]) { $we = defined $off1[$lw->[1] + 1] ? $s + $off1[$lw->[1] + 1] : $e }
      elsif (@off2 && $ns ne '') { $we = defined $off2[$lw->[1] + 1] ? $ns + $off2[$lw->[1] + 1] : $ne }
    }
    # The words around the match, to know the same scene in another video (a compilation and its own clip).
    my $tok = sub { join ' ', map { $T[$_][0] } @_ };
    my $mt = $tok->($m->[0] .. $m->[1]);
    my @keys;
    push @keys, 'b ' . $tok->(max(0, $m->[0] - 4) .. $m->[0] - 1) . " | $mt" if $m->[0] >= 3;
    push @keys, "a $mt | " . $tok->($m->[1] + 1 .. min($#T, $m->[1] + 4)) if $#T - $m->[1] >= 3;
    my $x = {lid => $lid, s => $s, e => ($spans && $ne ne '' ? $ne : $e), ws => $ws, we => $we, spans => $spans,
      score => $score, keys => \@keys};
    my $v = $video{$vid} //= {id => $vid, k => $k, title => $title, views => $views, kind => $kind, alive => $alive,
      checked => $checked, ckey => $ckey, cname => $cname, m => []};
    push @{$v->{m}}, $x;
  }
}
my @videos = grep { @{$_->{m}} } values %video;
for my $v (@videos) {
  my @m = sort { $a->{score} <=> $b->{score} || $a->{lid} <=> $b->{lid} } @{$v->{m}};
  $v->{best} = $m[0]; $v->{more} = $#m; $v->{n} = @m;
}
my $total = 0; $total += $_->{n} for @videos;
my $nvideos = @videos;
# The same scene is often in a compilation and in its own clip (or in two compilations): it is shown once, from the
# video with human captions if there is one, and the others are named under it ("same scene also in …").
my %scene;
for my $v (sort { ($b->{kind} eq 'human') <=> ($a->{kind} eq 'human') || $a->{best}{score} <=> $b->{best}{score}
    || $b->{views} <=> $a->{views} || $a->{id} cmp $b->{id} } @videos) {
  my $rep = first { defined } map { $scene{$_} } @{$v->{best}{keys}};
  if ($rep) { push @{$rep->{same}}, $v; $v->{dup} = 1 } else { $rep = $v }
  $scene{$_} //= $rep for @{$v->{best}{keys}};
}
@videos = grep { !$_->{dup} } @videos;
# Channels in turn (the one with the best line first), each channel's videos best line first.
my %by;
push @{$by{$_->{ckey}}}, $_ for @videos;
for (values %by) { @$_ = sort { $a->{best}{score} <=> $b->{best}{score} || $b->{views} <=> $a->{views} } @$_ }
my @order = sort { $by{$a}[0]{best}{score} <=> $by{$b}[0]{best}{score} || @{$by{$b}} <=> @{$by{$a}} } keys %by;
my @list;
while (grep { @{$by{$_}} } @order) { for (@order) { push @list, shift @{$by{$_}} if @{$by{$_}} } }

my $from = ($page - 1) * $limit;
my @pagev = @list[$from .. min($from + $limit, scalar @list) - 1];
my $s = state_note();
printf "(index: %s videos%s; \"%s\": %d matches in %d videos%s from %d channels%s)\n", commas($indexed), $s, $shown,
  $total, $nvideos, ($nvideos > @videos ? sprintf(', %d scenes', scalar @videos) : ''), scalar keys %by,
  @list ? sprintf('; showing %d-%d', $from + 1, $from + @pagev) : '';
if (!@pagev) {
  print @list ? "No more results (there are " . @list . ").\n" : "No matches" . ($opt{human} ? ' with human captions' : '') . ".\n";
  exit;
}

# ---- context, online check, output ----------------------------------------------------------------------------

my %ctx;
my @ranges = map { my $bm = $_->{best}; my $base = $_->{k} * 100000; sprintf "id BETWEEN %d AND %d", max($base, $bm->{lid} - 2), $bm->{lid} + 2 + ($bm->{spans} ? 1 : 0) } @pagev;
$ctx{$_->[0]} = $_ for sql("SELECT id, s, e, text FROM lines WHERE " . join(' OR ', @ranges) . ";");

check_online(@pagev) unless $opt{'no-check'};

my $n = $from;
for my $v (@pagev) {
  my $bm = $v->{best};
  my $yt = "https://youtu.be/$v->{id}?t=" . int($bm->{s} / 1000);
  my @info = ($v->{kind} eq 'human' ? 'human captions' : 'auto captions');
  push @info, $v->{alive} eq '200' ? 'online' : $v->{alive} eq '404' ? 'GONE (404)' : $v->{alive} =~ /^40[13]$/ ? "private or no embed ($v->{alive})" : $v->{alive} ? "online check: $v->{alive}" : ()
    unless $opt{'no-check'} && !$v->{alive};
  push @info, "+$v->{more} more in this video" if $v->{more};
  my @same = @{$v->{same} || []};
  push @info, 'same scene also in ' . join(', ', map { $_->{id} } @same[0 .. min(2, $#same)]) . (@same > 3 ? ' +' . (@same - 3) : '') if @same;
  my $words = defined $bm->{ws} && defined $bm->{we} ? sprintf('; words %s-%s', fmt_sec($bm->{ws}), fmt_sec($bm->{we})) : '';
  printf "%d. %s · %s\n   %s   (%s, %s-%s%s)   %s\n", ++$n, $v->{cname}, $v->{title}, $yt, $v->{id}, fmt_sec($bm->{s}), fmt_sec($bm->{e}), $words, join(' · ', @info);
  my $base = $v->{k} * 100000;
  my $last = $bm->{lid} + ($bm->{spans} ? 1 : 0);
  for my $id (max($base, $bm->{lid} - 2) .. $last + 2) {
    my $l = $ctx{$id} or next;
    my $mark = $id >= $bm->{lid} && $id <= $last ? '>>' : ' ';
    printf "   %-2s %8s  %s\n", $mark, fmt_time($l->[1] / 1000), $l->[3];
  }
  print '   clip: ', clip_json($v, $bm, $base, $last), "\n" if $opt{clip};
}

# A clip entry for docs/real-video/words/<word>.json (its note still to write): the line (both lines when the
# phrase runs on), its exact start and end in seconds, and one line before and after for "With context".
sub clip_json {
  my ($v, $bm, $base, $last) = @_;
  my $J = JSON::PP->new->allow_nonref;
  my $sec = sub { 0 + sprintf('%.2f', $_[0] / 1000) };
  my $line = join ' ', map { $ctx{$_} ? $ctx{$_}[3] : () } $bm->{lid} .. $last;
  my @around = map { my $l = $ctx{$_}; $l ? [$sec->($l->[1]), $sec->($l->[2]), $l->[3]] : () }
    ($bm->{lid} > $base ? $bm->{lid} - 1 : ()), $last + 1;
  sprintf '{"v":%s,"s":%s,"e":%s,"line":%s,"note":"","around":%s}', $J->encode($v->{id}), $sec->($bm->{s}),
    $sec->($bm->{e}), $J->encode($line), $J->encode(\@around);
}
print "(more: --page " . ($page + 1) . ")\n" if @list > $from + @pagev;

sub commas { my $x = reverse int(shift // 0); $x =~ s/(\d{3})(?=\d)/$1,/g; scalar reverse $x }

sub state_note {
  my $s = read_state();
  return '; collector paused until ' . localtime($s->{paused_until}) if ($s->{paused_until} // 0) > time;
  return '; still collecting' if ($s->{last_video_at} // 0) > time - 3 * 3600;
  '';
}

# YouTube oEmbed for the results shown (once every 3 days a video): 200 online, 404 gone, 401/403 private or not
# embeddable. The answer is kept in the index, so gone videos drop out of later searches.
sub check_online {
  my @v = grep { !($_->{alive} eq '200' && $_->{checked} > time - 3 * 86400) } @_;
  return unless @v;
  my @cmd = ('curl', '-s', '--parallel', '--parallel-max', '6', '--max-time', '10', '-w', '%{http_code} %{url}\n');
  push @cmd, '-o', 'NUL', "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D$_->{id}" for @v;
  open my $h, '-|', @cmd or return;
  my %code;
  while (<$h>) { $code{$2} = $1 if /^(\d{3}) .*?v%3D([\w-]{11})/ }
  close $h;
  my @upd;
  for my $v (@v) {
    my $c = $code{$v->{id}} or next;
    next if $c eq '000';
    $v->{alive} = $c;
    push @upd, sprintf("UPDATE videos SET alive=%d, checked_at=%d WHERE id=%s;", $c, time, sql_quote($v->{id}));
  }
  eval { sql(join "\n", 'BEGIN;', @upd, 'COMMIT;') } if @upd;
}

sub list_channels {
  printf "%-40s %8s %8s %8s\n", 'channel', 'videos', 'human', 'auto';
  for (sql("SELECT c.name, c.handle, sum(v.status='done'), sum(v.status='done' AND v.kind='human'), sum(v.status='done' AND v.kind='auto') FROM channels c LEFT JOIN videos v ON v.channel=c.key GROUP BY c.key ORDER BY c.rowid;")) {
    printf "%-40s %8d %8d %8d   %s\n", $_->[0], $_->[2] || 0, $_->[3] || 0, $_->[4] || 0, $_->[1];
  }
}
