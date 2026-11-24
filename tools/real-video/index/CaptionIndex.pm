package CaptionIndex;
# Shared parts of the private caption index (collect.pl, search.pl): where things live, the SQLite database,
# and the word splitter that matches SQLite's FTS5 "unicode61" tokenizer.
#
# The index (~/.cache/caption-index/index.db) holds YouTube captions downloaded for private use: it never goes
# in this repo (public), a page, a commit or anything a student loads.
use strict; use warnings; use utf8;
use JSON::PP; use File::Path qw(make_path); use IPC::Open3 qw(open3); use Symbol qw(gensym);
use Unicode::Normalize qw(NFD); use POSIX qw(strftime);
use Exporter 'import';
our @EXPORT = qw(win_path home_dir data_dir db_path tool sql sql_quote tokens fmt_time fmt_sec slurp read_state
  write_state channel_key load_channels init_db now
  page_tables clean_caps clip_views clip_view);

sub now { time }
sub win_path {   # Windows programs and this Perl both take C:/x/y (Git Bash's /c/x/y would be C:\c\x\y to them)
  my $p = shift; $p =~ s{\\}{/}g; $p =~ s{^/([a-zA-Z])(?=/|$)}{\U$1:}; $p;
}
sub home_dir { win_path($ENV{USERPROFILE} || $ENV{HOME} || '.') }
sub data_dir {
  my $d = win_path($ENV{CAPTION_INDEX_DIR} || home_dir() . '/.cache/caption-index');
  make_path($d) unless -d $d;
  $d;
}
sub db_path { data_dir() . '/index.db' }

# yt-dlp, sqlite3 and deno: %LOCALAPPDATA%\Programs\<name>\ (where they were installed on Nov 19), else PATH.
my %exe = ('yt-dlp' => ['yt-dlp', 'yt-dlp.exe'], sqlite3 => ['sqlite', 'sqlite3.exe'], deno => ['deno', 'deno.exe']);
my %found;
sub tool {
  my $name = shift;
  return $found{$name} if $found{$name};
  my ($dir, $file) = @{$exe{$name}};
  my $env = 'CAPTION_INDEX_' . uc($name =~ s/\W//gr);
  my @try = ($ENV{$env} ? win_path($ENV{$env}) : ());
  push @try, win_path($ENV{LOCALAPPDATA}) . "/Programs/$dir/$file" if $ENV{LOCALAPPDATA};
  my $path = $ENV{PATH} // '';
  push @try, map { "$_/$file" } split($path =~ /;/ ? qr/;/ : qr/:/, $path);
  for (@try) { return $found{$name} = $_ if -f $_ }
  die "Can't find $file (install it into %LOCALAPPDATA%\\Programs\\$dir\\, or set $env)\n";
}

# Runs SQL through sqlite3.exe (no SQLite module in Git Bash's Perl). Returns rows as array refs (NULL = '').
sub sql {
  my ($text, $db) = @_;
  $db //= db_path();
  my $err = gensym;
  my $pid = open3(my $in, my $out, $err, tool('sqlite3'), '-bail', '-batch', '-ascii', $db);
  binmode $in, ':encoding(UTF-8)';
  print $in ".timeout 30000\n", $text, "\n";
  close $in;
  binmode $out; my $o = do { local $/; <$out> } // '';
  binmode $err; my $e = do { local $/; <$err> } // '';
  waitpid $pid, 0;
  my $rc = $? >> 8;
  utf8::decode($e);
  die "sqlite3: $e\n" if $rc || $e =~ /\S/;
  utf8::decode($o);
  return map { [split /\x1F/, $_, -1] } grep { length } split /\x1E/, $o;
}
sub sql_quote {   # a text value; numbers go in as int($n)
  my $v = shift;
  return 'NULL' unless defined $v;
  $v =~ s/[\x00-\x08\x0B\x0C\x0E-\x1F]//g;
  $v =~ s/'/''/g;
  "'$v'";
}

# Words as FTS5's unicode61 tokenizer (remove_diacritics 2) sees them: letters and digits, lower case, no accents.
# "I’m tired." -> i, m, tired
sub tokens {
  my $t = lc(shift // '');
  return $t =~ /[a-z0-9]+/g unless $t =~ /[^\x00-\x7f]/;   # plain ASCII (most lines): the same words, much faster
  $t = NFD($t);
  $t =~ s/\p{Mn}+//g;
  return $t =~ /[\p{L}\p{N}\p{Co}]+/g;
}

sub fmt_time {   # seconds -> 1:23 or 1:02:03, like captionsearch.pl
  my $v = shift; return '?' unless defined $v && $v =~ /^[\d.]+$/;
  my $t = int $v;
  $t >= 3600 ? sprintf('%d:%02d:%02d', $t / 3600, $t / 60 % 60, $t % 60) : sprintf('%d:%02d', $t / 60, $t % 60);
}
sub fmt_sec { my $ms = shift; defined $ms && $ms ne '' ? sprintf('%.2f', $ms / 1000) : '?' }

sub slurp { my $f = shift; open my $h, '<:raw', $f or return ''; local $/; my $s = <$h> // ''; utf8::decode($s); $s }

sub read_state {
  my $f = data_dir() . '/state.json';
  my $s = -e $f ? eval { JSON::PP->new->decode(slurp($f)) } : undef;
  ref $s eq 'HASH' ? $s : {};
}
sub write_state {
  my $s = shift;
  my $f = data_dir() . '/state.json';
  open my $h, '>:encoding(UTF-8)', "$f.tmp" or die "can't write $f: $!\n";
  print $h JSON::PP->new->canonical->pretty->encode($s); close $h;
  rename "$f.tmp", $f or die "can't replace $f: $!\n";
}

# A channel's key in the index is its name in channels.json, made simple: "Will & Grace" -> will-grace.
sub channel_key { my $k = lc shift; $k =~ s/[^a-z0-9]+/-/g; $k =~ s/^-|-$//g; $k }

sub load_channels {
  my $f = shift;
  my $d = JSON::PP->new->decode(slurp($f));
  my @c = @{$d->{channels} || []};
  $_->{key} = channel_key($_->{name}) for @c;
  @c;
}

# lines.id = videos.k * 100000 + line number, so a video's lines are one id range and FTS rowids follow them.
# win = the full-text index: one row per line, holding that line and the next one, so a phrase split across two
# caption lines is still found. It is contentless (the text lives in lines), which keeps the file small.
sub init_db {
  sql(<<'SQL');
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS channels(key TEXT PRIMARY KEY, id TEXT, name TEXT, handle TEXT, listed_at INTEGER,
  listed INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS videos(k INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, channel TEXT NOT NULL, title TEXT,
  dur INTEGER, views INTEGER, uploaded TEXT, status TEXT NOT NULL DEFAULT 'later', kind TEXT, lang TEXT,
  embed INTEGER, lines INTEGER, tries INTEGER NOT NULL DEFAULT 0, note TEXT, fetched_at INTEGER,
  alive INTEGER, checked_at INTEGER);
CREATE INDEX IF NOT EXISTS videos_queue ON videos(status, channel, views);
CREATE TABLE IF NOT EXISTS lines(id INTEGER PRIMARY KEY, s INTEGER NOT NULL, e INTEGER NOT NULL, text TEXT NOT NULL,
  w TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS win USING fts5(text, content='', contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2');
SQL
}

# ---- the page's own tables and a clip as the pages show it (site.pl, search.pl --json, sync.pl) ----
# marks = ♥ kept / 🙈 hidden; times = his own start / end (s = e = -1: set back); caps = a clip's caption lines as he
# edited them (JSON {clip: n, lines: [[s, e, text, word times?], …]}, lines[n] = the clip's own line; data NULL = back
# to the index's own). Undone marks, times and captions keep their time, so the sync knows which side is newer.
sub page_tables {
  sql(join "\n",
    "CREATE TABLE IF NOT EXISTS marks(lid INTEGER PRIMARY KEY, last INTEGER, kind TEXT NOT NULL, query TEXT, at INTEGER);",
    "CREATE TABLE IF NOT EXISTS times(lid INTEGER PRIMARY KEY, s REAL NOT NULL, e REAL NOT NULL, at INTEGER);",
    "CREATE TABLE IF NOT EXISTS caps(lid INTEGER PRIMARY KEY, last INTEGER, data TEXT, at INTEGER);",
    # Clips he has watched on the page (played for a second or more): grayed in the lists (his wish, Nov 24).
    "CREATE TABLE IF NOT EXISTS seen(lid INTEGER PRIMARY KEY, at INTEGER);");
  sql('ALTER TABLE times ADD COLUMN last INTEGER;') unless grep { $_->[1] eq 'last' } sql('PRAGMA table_info(times);');
}

# Edited caption lines, checked: times in seconds, text on one line, an emptied line left out (never the clip's own).
# Returns {clip, lines} or nothing.
sub clean_caps {
  my $d = shift;
  return unless ref $d eq 'HASH' && ref $d->{lines} eq 'ARRAY' && defined $d->{clip} && $d->{clip} =~ /^\d+$/;
  my $num = qr/^\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
  my (@l, $clip);
  for my $n (0 .. $#{$d->{lines}}) {
    my $x = $d->{lines}[$n];
    return unless ref $x eq 'ARRAY' && defined $x->[0] && defined $x->[1] && "$x->[0]" =~ $num && "$x->[1]" =~ $num;
    my ($s, $e, $t, $w) = @$x;
    $t = defined $t && !ref $t ? "$t" : '';
    $t =~ s/[\x00-\x1F\x7F]+/ /g; $t =~ s/\s+/ /g; $t =~ s/^ | $//g;
    if (!length $t) { return if $n == $d->{clip}; next }
    $t = substr($t, 0, 400);
    my $nw = () = $t =~ /\S+/g;
    my @w = ref $w eq 'ARRAY' && @$w == $nw && !grep { !defined || "$_" !~ $num } @$w ? map { 0 + sprintf('%.2f', $_) } @$w : ();
    $s = 0 + sprintf('%.2f', $s); $e = 0 + sprintf('%.2f', $e < $s + 0.1 ? $s + 0.1 : $e);
    $clip = scalar @l if $n == $d->{clip};
    push @l, [$s, $e, $t, (@w ? \@w : ())];
  }
  return unless defined $clip && @l <= 40;
  {clip => $clip, lines => \@l};
}

# Clips as the pages show them, for [line id, last line id] pairs (in one go, for a page of results): the video, the
# clip's line ("screens": two lines before, the clip's own line (both lines when the phrase runs on), two after; or his
# edited lines), s / e (his times, else the clip line's own), s0 / e0 (the clip line's own times), timed, edited, and
# orig (the index's lines) when he edited them. undef for a pair the index doesn't have.
sub clip_views {
  my @p = map { my ($l, $t) = map { int($_ // 0) } @$_[0, 1]; [$l, $t || $l] } @_;
  my $ok = sub { my ($l, $t) = @{$_[0]}; $l > 0 && int($t / 100000) == int($l / 100000) && $t >= $l && $t - $l <= 3 };
  my @want = grep { $ok->($_) } @p;
  return map { undef } @p unless @want;
  my %ks = map { int($_->[0] / 100000) => 1 } @want;
  my %vid = map { $_->[0] => $_ } sql("SELECT v.k, v.id, ifnull(v.title,''), ifnull(c.name, v.channel), ifnull(c.show,''), ifnull(v.kind,'') FROM videos v LEFT JOIN channels c ON c.key = v.channel WHERE v.k IN (" . join(',', sort keys %ks) . ");");
  my %by = map { $_->[0] => $_ } sql("SELECT id, s, e, text, ifnull(w,'') FROM lines WHERE " .
    join(' OR ', map { my $b = int($_->[0] / 100000) * 100000; sprintf 'id BETWEEN %d AND %d', ($_->[0] - 2 < $b ? $b : $_->[0] - 2), $_->[1] + 2 } @want) . ';');
  my $in = join ',', map { $_->[0] } @want;
  my %caps = map { $_->[0] => $_ } eval { sql("SELECT lid, ifnull(data,''), ifnull(at,0) FROM caps WHERE lid IN ($in);") };
  my %times = map { $_->[0] => $_ } eval { sql("SELECT lid, s, e FROM times WHERE s >= 0 AND lid IN ($in);") };
  my $sec = sub { 0 + sprintf('%.2f', $_[0] / 1000) };
  my $scr = sub {   # an index line; its words' times where the auto-captions had them (w = ms after the line's start)
    my $r = shift;
    my @w = split ' ', $r->[4]; my $nw = () = $r->[3] =~ /\S+/g;
    {s => $sec->($r->[1]), e => $sec->($r->[2]), t => $r->[3], (@w && @w == $nw ? (w => [map { $sec->($r->[1] + $_) } @w]) : ())};
  };
  my $three = sub { [map { [$_->{s}, $_->{e}, $_->{t}] } @_] };
  my $build = sub {
    my ($lid, $last) = @{$_[0]};
    my $v = $ok->($_[0]) ? $vid{int($lid / 100000)} : undef;
    return undef if !$v || !$by{$lid} || !$by{$last};
    {
      my @before = map { $by{$_} ? $scr->($by{$_}) : () } grep { int($_ / 100000) == int($lid / 100000) } $lid - 2, $lid - 1;
      my @after = map { $by{$_} ? $scr->($by{$_}) : () } $last + 1, $last + 2;
      my @own = map { $scr->($by{$_}) } grep { $by{$_} } $lid .. $last;
      my $star = {s => $own[0]{s}, e => $own[-1]{e}, t => join(' ', map { $_->{t} } @own)};
      $star->{w} = [map { @{$_->{w}} } @own] unless grep { !$_->{w} } @own;
      my %c = (v => $v->[1], title => $v->[2], channel => $v->[3], show => $v->[4], kind => $v->[5],
        lid => 0 + $lid, last => 0 + $last, screens => [@before, $star, @after], clip => scalar @before, edited => 0, timed => 0);
      my $cr = $caps{$lid};
      my $d = $cr && length $cr->[1] ? clean_caps(eval { JSON::PP->new->decode($cr->[1]) }) : undef;
      if ($d) {
        $c{orig} = {s => $star->{s}, e => $star->{e}, line => $star->{t}, around => $three->(@before, @after)};
        $c{screens} = [map { {s => $_->[0], e => $_->[1], t => $_->[2], ($_->[3] ? (w => $_->[3]) : ())} } @{$d->{lines}}];
        $c{clip} = $d->{clip}; $c{edited} = 1;
      }
      my $sc = $c{screens}[$c{clip}];
      @c{qw(s0 e0 line)} = ($sc->{s}, $sc->{e}, $sc->{t});
      if (my $t = $times{$lid}) { @c{qw(s e)} = (0 + $t->[1], 0 + $t->[2]); $c{timed} = 1 } else { @c{qw(s e)} = @c{qw(s0 e0)} }
      $c{around} = $three->(@{$c{screens}}[grep { $_ != $c{clip} } 0 .. $#{$c{screens}}]);
      return \%c;
    }
  };
  map { $build->($_) } @p;
}
sub clip_view { (clip_views([@_]))[0] }

1;
