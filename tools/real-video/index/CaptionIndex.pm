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
  write_state channel_key load_channels init_db now);

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
  my $t = NFD(lc(shift // ''));
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

1;
