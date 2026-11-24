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
#   --forms         any forms (the page's "Any forms"): shake also finds shakes, shook, shaken, shaking; hand, hands;
#                   didn't = did not = didnt; and the words in order with up to 2 words between ("shake his hand").
#                   Order: the phrase as typed, then with words between, then other forms (WordForms.pm)
#   --human         only uploaded (human) captions: their text is exact; auto-captions can mishear
#   --channel office,friends   only these channels (part of the name is enough); --not snl,colbert leaves them out
#   --all           also videos that can't be embedded or were found gone (the clip page can't play them)
#   --no-check      skip the online check (YouTube oEmbed: 200 = online, 404 = gone, 401/403 = private or no embed)
#   --show breaking-bad   only this TV show (a student's favorite; part of the name is enough, "-" = a space);
#                   --shows lists the shows and how much of each is searchable
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
use CaptionIndex; use WordForms qw(word_forms phrase_variants little_word);
use List::Util qw(min max first product); use JSON::PP;
binmode STDOUT, ':encoding(UTF-8)'; binmode STDERR, ':encoding(UTF-8)';

my (%opt, @args);
@ARGV = map { my $x = $_; utf8::decode($x); $x } @ARGV;
while (@ARGV) {
  my $arg = shift @ARGV;
  if ($arg =~ /^--(page|channel|not|show)$/) { push @{$opt{$1}}, shift @ARGV }
  elsif ($arg =~ /^--(page|channel|not|show)=(.*)$/) { push @{$opt{$1}}, $2 }
  elsif ($arg =~ /^--(human|all|no-check|channels|shows|clip|json|forms|help)$/) { $opt{$1} = 1 }
  elsif ($arg =~ /^--/) { die "unknown option $arg (see the top of $0)\n" }
  else { push @args, $arg }
}
my $db = db_path();
die "No caption index yet ($db). Start the collector: perl tools/real-video/index/collect.pl --install\n" unless -e $db;
if ($opt{channels}) { list_channels(); exit }
if ($opt{shows}) { list_shows(); exit }
my ($query, $limit) = @args;
die "usage: perl tools/real-video/index/search.pl \"phrase\" [how many] [--page N] [--human] [--channel x,y] [--not x] [--all] [--no-check]\n"
  unless defined $query && $query =~ /\S/;
$limit = 10 unless defined $limit && $limit =~ /^\d+$/ && $limit > 0;
my $page = ($opt{page} && $opt{page}[-1] =~ /^\d+$/) ? max(1, $opt{page}[-1]) : 1;

# ---- the query ------------------------------------------------------------------------------------------------

# A phrase = [[word, is prefix, glued, forms], …]: glued = a piece of the same typed word as the one before ("didn't"
# is "didn" "t"), nothing may come between them; forms = with --forms, the forms of the word that the index has.
# An alternative = {phrases => [...], near => N or undef, changed => said another way (did not for didn't)}.
sub phrase_tokens {
  my @t;
  for my $w (split ' ', shift) {
    my $pre = $w =~ s/\*+$//;
    my @x = tokens($w);
    push @t, map { [$x[$_], 0, $_ > 0 ? 1 : 0] } 0 .. $#x;
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

# --forms: up to 2 words may come between the searched words ("shake his hand"); never inside a contraction.
my $GAP = $opt{forms} ? 2 : 0;
my %GLUE = map { $_ => 1 } qw(t s m re ll ve d);
if ($opt{forms}) {
  # Each phrase said every way (didn't = did not = didnt; a phrase with a tire* word stays as typed), then every
  # word's forms, kept to the ones the index has (WordForms.pm).
  my $variants = sub {
    my $p = shift;
    return [$p, 0] if grep { $_->[1] } @$p;
    map { my ($t, $changed) = @$_; $changed ? [[map { [$t->[$_], 0, ($_ > 0 && $GLUE{$t->[$_]}) ? 1 : 0] } 0 .. $#$t], 1] : [$p, 0] }
      phrase_variants([map { $_->[0] } @$p]);
  };
  my @expanded;
  for my $a (@alts) {
    my @combos = ([[], 0]);   # a ~ b: every way of saying a with every way of saying b (at most 24)
    for my $p (@{$a->{phrases}}) {
      my @vs = $variants->($p);
      @combos = map { my $c = $_; map { [[@{$c->[0]}, $_->[0]], $c->[1] || $_->[1]] } @vs } @combos;
      splice @combos, 24 if @combos > 24;
    }
    push @expanded, map { {phrases => $_->[0], near => $a->{near}, changed => $_->[1]} } @combos;
  }
  my %cand;
  for my $a (@expanded) { for my $p (@{$a->{phrases}}) { $cand{$_} = 1 for map { $_->[1] ? () : word_forms($_->[0]) } @$p } }
  my %have = %cand ? map { $_->[0] => $_->[1] } sql("CREATE VIRTUAL TABLE temp.vocab USING fts5vocab(main, 'win', 'row'); "
    . 'SELECT term, doc FROM temp.vocab WHERE term IN (' . join(',', map { sql_quote($_) } sort keys %cand) . ');') : ();
  for my $a (@expanded) { for my $p (@{$a->{phrases}}) { for my $s (grep { !$_->[1] } @$p) { $s->[3] = {map { $_ => 1 } word_forms($s->[0], \%have)} } } }
  # Words between only between two words that carry meaning ("shake his hand", not "I … am"): next to a little word
  # the phrase stays together.
  for my $a (@expanded) { for my $p (@{$a->{phrases}}) { for my $j (1 .. $#$p) { $p->[$j][2] = 1 if little_word($p->[$j][0]) || little_word($p->[$j - 1][0]) } } }
  @alts = @expanded;
}

# FTS5 can't put a prefix word in the middle of a phrase: such a phrase is split, and the exact check below decides.
sub fts_parts {
  my (@parts, @cur);
  for my $x (@{shift()}) { push @cur, $x; if ($x->[1]) { push @parts, [@cur]; @cur = () } }
  push @parts, [@cur] if @cur;
  map { my $p = $_; '"' . join(' ', map { $_->[0] } @$p) . '"' . ($p->[-1][1] ? '*' : '') } @parts;
}
# --forms: each word as any of its forms. For each way of choosing the forms (when there aren't too many), the words
# that stay together are one FTS phrase, and the phrases are NEAR each other (words between); else every word, any
# form, anywhere in the two lines. The exact check below decides the order and the gaps.
my $budget = 400;
sub slot_terms { my $s = shift; $s->[1] ? [$s->[0], 1] : map { [$_, 0] } sort keys %{$s->[3] || {$s->[0] => 1}} }
sub fts_forms {
  my $q = shift;
  my @slots = map { @$_ } @{$q->{phrases}};
  my @f = map { [slot_terms($_)] } @slots;
  my $n = product(map { scalar @$_ } @f);
  if (!$q->{near} && $n <= 64 && $n <= $budget) {
    $budget -= $n;
    my @combos = ([]);
    for my $x (@f) { @combos = map { my $c = $_; map { [@$c, $_] } @$x } @combos }
    # (a word* start ends its FTS phrase: FTS5 takes * only at a phrase's end)
    my @groups = ([0]); for my $j (1 .. $#slots) { $slots[$j][2] && !$slots[$j - 1][1] ? push @{$groups[-1]}, $j : push @groups, [$j] }
    return '(' . join(' OR ', map {
      my $c = $_;
      my @ph = map { my $g = $_; '"' . join(' ', map { $c->[$_][0] } @$g) . '"' . ($c->[$g->[-1]][1] ? '*' : '') } @groups;
      @ph == 1 ? $ph[0] : 'NEAR(' . join(' ', @ph) . ', ' . ($GAP * $#ph) . ')';
    } @combos) . ')';
  }
  '(' . join(' AND ', map { '(' . join(' OR ', map { '"' . $_->[0] . '"' . ($_->[1] ? '*' : '') } @$_) . ')' } @f) . ')';
}
my $fts = join ' OR ', map {
  my $q = $_;
  if ($opt{forms}) { fts_forms($q) }
  elsif (!$q->{near}) { '(' . join(' AND ', fts_parts($q->{phrases}[0])) . ')' }
  else {
    my $extra = 0; $extra += @$_ for @{$q->{phrases}};
    'NEAR(' . join(' ', map { fts_parts($_) } @{$q->{phrases}}) . ', ' . ($q->{near} + $extra) . ')';
  }
} @alts;
my $shown = join ' | ', map { my $q = $_; join($q->{near} ? " ~$q->{near} " : ' ', map { join ' ', map { $_->[0] . ($_->[1] ? '*' : '') } @$_ } @{$q->{phrases}}) } @alts;

# ---- candidates -----------------------------------------------------------------------------------------------

my @where = ("v.status='done'");
push @where, "v.kind IN ('human','lyrics')" if $opt{human};   # exact words: uploaded captions, or a song's lyrics
push @where, "(v.embed IS NULL OR v.embed=1)", "(v.alive IS NULL OR v.alive=200)" unless $opt{all};
my $chan = sub {
  my @n = map { my $x = lc; $x =~ s/'/''/g; $x =~ s/[%_]//g; $x } grep { length } map { split /\s*,\s*/ } @_;
  join ' OR ', map { "lower(ifnull(c.name,'')) LIKE '%$_%' OR lower(ifnull(c.handle,'')) LIKE '%$_%' OR v.channel LIKE '%$_%'" } @n;
};
push @where, '(' . $chan->(@{$opt{channel}}) . ')' if $opt{channel} && $chan->(@{$opt{channel}});
push @where, 'NOT (' . $chan->(@{$opt{not}}) . ')' if $opt{not} && $chan->(@{$opt{not}});
if ($opt{show}) {
  my @s = map { my $x = lc; $x =~ s/[-_]+/ /g; $x =~ s/'/''/g; $x =~ s/[%]//g; $x } grep { length } map { split /\s*,\s*/ } @{$opt{show}};
  push @where, '(' . join(' OR ', map { "lower(ifnull(c.show,'')) LIKE '%$_%'" } @s) . ')' if @s;
}
(my $ftsq = $fts) =~ s/'/''/g;
my @rows = sql(<<"SQL");
SELECT l.id, l.s, l.e, l.text, ifnull(l.w,''), ifnull(n.text,''), ifnull(n.e,''), ifnull(n.w,''), ifnull(n.s,''),
  v.k, v.id, ifnull(v.title,''), ifnull(v.views,0), ifnull(v.kind,''), ifnull(v.alive,''), ifnull(v.checked_at,0),
  v.channel, ifnull(c.name, v.channel), ifnull(v.dur, 0)
FROM win JOIN lines l ON l.id = win.rowid JOIN videos v ON v.k = l.id / 100000
LEFT JOIN channels c ON c.key = v.channel LEFT JOIN lines n ON n.id = l.id + 1
WHERE win MATCH '$ftsq' AND @{[join ' AND ', @where]}
LIMIT 50000;
SQL
my ($indexed) = map { $_->[0] } sql("SELECT count(*) FROM videos WHERE status='done';");

# ---- exact matches --------------------------------------------------------------------------------------------

my %TOK;   # a line's tokens, once (it is also the next line of the row before it)
sub line_tokens {   # [token, word number] for each token of a line
  my ($text, $id) = @_;
  return @{$TOK{$id}} if defined $id && $TOK{$id};
  my @t; my $wi = 0;
  for my $w (split ' ', $text) { push @t, [$_, $wi] for tokens($w); $wi++ }
  $TOK{$id} = \@t if defined $id;
  @t;
}
# A phrase in the tokens: [first, last, words between, another form]. Up to $gap words may come between its words
# (not between glued pieces); a word matches as typed, as one of its forms (--forms) or, with *, by its start.
my %SETS;   # each phrase's words as sets of the tokens they match (undef: a word* start)
sub occurrences {
  my ($T, $p, $gap) = @_;
  $gap //= 0;
  my $set = $SETS{$p} //= [map { $_->[1] ? undef : ($_->[3] || {$_->[0] => 1}) } @$p];
  my @o;
  POS: for my $i (0 .. $#$T) {
    my $t = $T->[$i][0];
    next unless $set->[0] ? $set->[0]{$t} : index($t, $p->[0][0]) == 0;
    my ($at, $gaps, $oth) = ($i, 0, $set->[0] && $t ne $p->[0][0]);
    for my $j (1 .. $#$p) {
      my $last = $at + 1 + ($p->[$j][2] ? 0 : $gap); $last = $#$T if $last > $#$T;
      my $k;
      for my $x ($at + 1 .. $last) {
        my $u = $T->[$x][0];
        if ($set->[$j] ? $set->[$j]{$u} : index($u, $p->[$j][0]) == 0) { $k = $x; last }
      }
      next POS unless defined $k;
      $gaps += $k - $at - 1; $oth ||= $set->[$j] && $T->[$k][0] ne $p->[$j][0]; $at = $k;
    }
    push @o, [$i, $at, $gaps, $oth ? 1 : 0];
  }
  @o;
}
# Each match as [first token, last token, tier] in the line and the next one; only matches that start in the line
# count (the next line's own row finds the ones that start there). Tier (--forms): 0 = as typed, 1 = with words
# between, 2 = another form or another way of saying it (did not for didn't), 3 = both.
sub matches {
  my ($T, $n0) = @_;
  my @m;
  for my $alt (@alts) {
    my @occ = map { [occurrences($T, $_, $alt->{near} ? 0 : $GAP)] } @{$alt->{phrases}};
    if (!$alt->{near}) { push @m, map { [$_->[0], $_->[1], ($alt->{changed} || $_->[3] ? 2 : 0) + ($_->[2] ? 1 : 0)] } @{$occ[0]}; next }
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
      push @m, [min(map { $_->[0] } @s), max(map { $_->[1] } @s), ($alt->{changed} || grep { $_->[3] } @pick) ? 2 : 0]
        if $between <= $alt->{near};
    }
  }
  my %seen;
  grep { $_->[0] < $n0 && !$seen{"$_->[0]"}++ } sort { $a->[0] <=> $b->[0] || $a->[2] <=> $b->[2] } @m;
}

# Clips he marked on the page (site.pl): 🙈 hidden ones never come back; ♥ liked and ★ super-liked ones come first.
my %hide = map { $_->[0] => 1 } eval { sql("SELECT lid FROM marks WHERE kind='hide';") };
my %keep = map { $_->[0] => 1 } eval { sql("SELECT lid FROM marks WHERE kind IN ('keep','super');") };
my %super = map { $_->[0] => 1 } eval { sql("SELECT lid FROM marks WHERE kind='super';") };
# 0 = ★ super liked, 1 = ♥ liked, 2 = the rest (his wish, Nov 24: super likes before the others of that search).
sub mark_rank { my $lid = shift; $super{$lid} ? 0 : $keep{$lid} ? 1 : 2 }
my %video;
for my $r (@rows) {
  my ($lid, $s, $e, $text, $w, $ntext, $ne, $nw, $ns, $k, $vid, $title, $views, $kind, $alive, $checked, $ckey, $cname, $dur) = @$r;
  next if $hide{$lid};
  my @t1 = line_tokens($text, $lid);
  my @t2 = map { [$_->[0], $_->[1], 1] } line_tokens($ntext, $lid + 1);
  my @T = ((map { [@$_, 0] } @t1), @t2);
  for my $m (matches(\@T, scalar @t1)) {
    my $spans = $T[$m->[1]][2];
    my $words = scalar(() = $text =~ /\S+/g);
    # Short lines first; short scene clips before long compilations (they repeat the same scenes and are harder to
    # watch): up to 10 minutes +0, up to 30 minutes +3, longer +6.
    my $score = $words + ($spans ? 4 : 0) + ($kind eq 'auto' ? 1 : 0) + ($dur > 1800 ? 6 : $dur > 600 ? 3 : 0);
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
      score => $score, tier => $m->[2] // 0, keys => \@keys};
    my $v = $video{$vid} //= {id => $vid, k => $k, title => $title, views => $views, kind => $kind, alive => $alive,
      checked => $checked, ckey => $ckey, cname => $cname, m => []};
    push @{$v->{m}}, $x;
  }
}
my @videos = grep { @{$_->{m}} } values %video;
for my $v (@videos) {
  my @m = sort { $a->{tier} <=> $b->{tier} || $a->{score} <=> $b->{score} || $a->{lid} <=> $b->{lid} } @{$v->{m}};
  $v->{best} = $m[0]; $v->{more} = $#m; $v->{n} = @m;
}
my $total = 0; $total += $_->{n} for @videos;
my $nvideos = @videos;
# The same scene is often in a compilation and in its own clip (or in two compilations): it is shown once, from the
# video with human captions if there is one, and the others are named under it ("same scene also in …").
my %scene;
# (A scene he liked stays as the clip he liked, not its copy in another video.)
for my $v (sort { mark_rank($a->{best}{lid}) <=> mark_rank($b->{best}{lid}) || $a->{best}{tier} <=> $b->{best}{tier} || ($b->{kind} eq 'human') <=> ($a->{kind} eq 'human') || $a->{best}{score} <=> $b->{best}{score}
    || $b->{views} <=> $a->{views} || $a->{id} cmp $b->{id} } @videos) {
  my $rep = first { defined } map { $scene{$_} } @{$v->{best}{keys}};
  if ($rep) { push @{$rep->{same}}, $v; $v->{dup} = 1 } else { $rep = $v }
  $scene{$_} //= $rep for @{$v->{best}{keys}};
}
@videos = grep { !$_->{dup} } @videos;
# Channels in turn (the one with the best line first), each channel's videos best line first.
my %by;
push @{$by{$_->{ckey}}}, $_ for @videos;
for (values %by) { @$_ = sort { $a->{best}{tier} <=> $b->{best}{tier} || $a->{best}{score} <=> $b->{best}{score} || $b->{views} <=> $a->{views} } @$_ }
my @order = sort { $by{$a}[0]{best}{tier} <=> $by{$b}[0]{best}{tier} || $by{$a}[0]{best}{score} <=> $by{$b}[0]{best}{score} || @{$by{$b}} <=> @{$by{$a}} } keys %by;
my @list;
while (grep { @{$by{$_}} } @order) { for (@order) { push @list, shift @{$by{$_}} if @{$by{$_}} } }
# Clips he super-liked (★ on the page) come first, then the ones he liked (♥), then the rest; within each, the phrase
# as typed, then with words between, then other forms (--forms), each in the same order.
my @ix = sort { mark_rank($list[$a]{best}{lid}) <=> mark_rank($list[$b]{best}{lid}) || $list[$a]{best}{tier} <=> $list[$b]{best}{tier} || $a <=> $b } 0 .. $#list;
@list = @list[@ix];

my $from = ($page - 1) * $limit;
my @pagev = @list[$from .. min($from + $limit, scalar @list) - 1];
json_out() if $opt{json};
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
  my @info = ($v->{kind} eq 'human' ? 'human captions' : $v->{kind} eq 'lyrics' ? 'song lyrics (lined up)' : 'auto captions');
  push @info, $v->{alive} eq '200' ? 'online' : $v->{alive} eq '404' ? 'GONE (404)' : $v->{alive} =~ /^40[13]$/ ? "private or no embed ($v->{alive})" : $v->{alive} ? "online check: $v->{alive}" : ()
    unless $opt{'no-check'} && !$v->{alive};
  push @info, ('', 'words between', 'another form', 'another form, words between')[$bm->{tier}] if $bm->{tier};
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

# --json: the same results as data, for the private page on his PC (site.pl). Prints one JSON object and exits.
sub json_out {
  my %ctx2;
  if (@pagev) {
    my @r = map { my $bm = $_->{best}; my $base = $_->{k} * 100000; sprintf "id BETWEEN %d AND %d", max($base, $bm->{lid} - 2), $bm->{lid} + 3 + ($bm->{spans} ? 1 : 0) } @pagev;
    $ctx2{$_->[0]} = $_ for sql("SELECT id, s, e, text FROM lines WHERE " . join(' OR ', @r) . ";");
    %ctx = %ctx2;
    check_online(@pagev) unless $opt{'no-check'};
  }
  my $sec = sub { defined $_[0] && $_[0] ne '' ? 0 + sprintf('%.2f', $_[0] / 1000) : undef };
  # Each clip as the page shows it: his edited lines where he changed them, his own start / end where he moved them.
  my @views = clip_views(map { [$_->{best}{lid}, $_->{best}{lid} + ($_->{best}{spans} ? 1 : 0)] } @pagev);
  my $n = $from;
  my @res;
  for my $x (0 .. $#pagev) {
    my $v = $pagev[$x];
    my $bm = $v->{best};
    my $base = $v->{k} * 100000;
    my $last = $bm->{lid} + ($bm->{spans} ? 1 : 0);
    my @lines = map { my $l = $ctx2{$_}; $l ? {s => $sec->($l->[1]), e => $sec->($l->[2]), text => $l->[3],
      hit => ($_ >= $bm->{lid} && $_ <= $last ? JSON::PP::true : JSON::PP::false)} : () } max($base, $bm->{lid} - 2) .. $last + 2;
    my $cv = $views[$x];
    @lines = map { {s => $cv->{screens}[$_]{s}, e => $cv->{screens}[$_]{e}, text => $cv->{screens}[$_]{t},
      hit => $_ == $cv->{clip} ? JSON::PP::true : JSON::PP::false} } 0 .. $#{$cv->{screens}} if $cv && $cv->{edited};
    push @res, {n => ++$n, lid => 0 + $bm->{lid}, last => 0 + $last, channel => $v->{cname}, title => $v->{title}, id => $v->{id}, s => $sec->($bm->{s}),
      e => $sec->($bm->{e}), ws => $sec->($bm->{ws}), we => $sec->($bm->{we}), kind => $v->{kind},
      alive => ($v->{alive} eq '' ? undef : 0 + $v->{alive}), more => $v->{more},
      same => [map { $_->{id} } @{$v->{same} || []}], lines => \@lines,
      # 🙈 on the page hides this line and the same scene in the other videos; ⭐ = kept already
      scene => [0 + $bm->{lid}, map { 0 + $_->{best}{lid} } @{$v->{same} || []}],
      kept => ($keep{$bm->{lid}} ? JSON::PP::true : JSON::PP::false), super => ($super{$bm->{lid}} ? JSON::PP::true : JSON::PP::false),
      clip => ($cv ? {v => $cv->{v}, s => $cv->{s}, e => $cv->{e}, line => $cv->{line}, note => '', around => $cv->{around}}
        : JSON::PP->new->decode(clip_json($v, $bm, $base, $last)))};
    $res[-1]{tier} = 0 + $bm->{tier} if $bm->{tier};   # --forms: 1 words between, 2 another form, 3 both
    $res[-1]{timed} = JSON::PP::true if $cv && $cv->{timed};
    $res[-1]{edited} = JSON::PP::true if $cv && $cv->{edited};
  }
  # Clips he has already watched on the page: grayed there.
  if (@res) {
    my %seen = map { $_->[0] => 1 } eval { sql('SELECT lid FROM seen WHERE lid IN (' . join(',', map { $_->{lid} } @res) . ');') };
    $_->{seen} = JSON::PP::true for grep { $seen{$_->{lid}} } @res;
  }
  my $st = read_state();
  print JSON::PP->new->canonical->encode({indexed => 0 + $indexed, query => $shown, total => $total,
    ($opt{forms} ? (forms => JSON::PP::true, hl => [highlights()]) : ()),
    videos => $nvideos, scenes => scalar @videos, channels => scalar keys %by, from => $from, page => $page,
    limit => $limit, count => scalar @list, more => (@list > $from + @pagev ? JSON::PP::true : JSON::PP::false),
    paused_until => ($st->{paused_until} // 0) > time ? $st->{paused_until} : undef,
    pause_reason => ($st->{paused_until} // 0) > time ? $st->{pause_reason} : undef, results => \@res}), "\n";
  exit;
}

# --forms: what the page marks in the lines (JavaScript regex sources, flags "giu"): each way of saying each phrase,
# each word as any of its forms, up to 2 words between them.
sub highlights {
  my ($L, $NL) = ('[\p{L}\p{N}]', '[^\p{L}\p{N}]');
  my $slot = sub { my $s = shift; $s->[1] ? "$s->[0]$L*" : '(?:' . join('|', sort { length $b <=> length $a || $a cmp $b } keys %{$s->[3] || {$s->[0] => 1}}) . ')' };
  my $join = sub {
    my ($p, $gap) = @_;
    join '', map { ($_ ? ($p->[$_][2] || !$gap ? "$NL+" : "$NL+(?:$L+$NL+){0,$gap}") : '') . $slot->($p->[$_]) } 0 .. $#$p;
  };
  my %seen;
  grep { !$seen{$_}++ } map { my $a = $_; $a->{near} ? map { $join->($_, 0) } @{$a->{phrases}} : $join->($a->{phrases}[0], $GAP) } @alts;
}

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

sub list_shows {   # one show can come from several channels
  printf "%-28s %8s %8s %8s %9s\n", 'show', 'videos', 'human', 'hours', 'to fetch';
  for (sql("SELECT c.show, sum(v.status='done'), sum(v.status='done' AND v.kind='human'), round(sum(CASE WHEN v.status='done' THEN v.dur END) / 3600.0, 1), sum(v.status='todo') FROM channels c LEFT JOIN videos v ON v.channel=c.key WHERE ifnull(c.show,'') <> '' GROUP BY c.show ORDER BY c.show;")) {
    printf "%-28s %8d %8d %8s %9d\n", $_->[0], $_->[1] || 0, $_->[2] || 0, $_->[3] || 0, $_->[4] || 0;
  }
  print "(search one of them with --show, e.g. --show breaking-bad)\n";
}
sub list_channels {
  printf "%-40s %8s %8s %8s\n", 'channel', 'videos', 'human', 'auto';
  for (sql("SELECT c.name, c.handle, sum(v.status='done'), sum(v.status='done' AND v.kind='human'), sum(v.status='done' AND v.kind='auto') FROM channels c LEFT JOIN videos v ON v.channel=c.key GROUP BY c.key ORDER BY c.rowid;")) {
    printf "%-40s %8d %8d %8d   %s\n", $_->[0], $_->[2] || 0, $_->[3] || 0, $_->[4] || 0, $_->[1];
  }
}
