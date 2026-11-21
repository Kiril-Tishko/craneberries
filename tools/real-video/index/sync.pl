#!/usr/bin/env perl
# His picks online: keeps docs/real-video/picks/picks.json on GitHub the same as the caption index on his PC, both
# ways. Picks = every clip he ♥ liked and every clip whose start / end he moved, on the page (site.html) or online
# (docs/real-video/picks/index.html, which other sessions also read to put clips into lessons).
#
#   perl tools/real-video/index/sync.pl          keep them in sync (what the "Caption index sync" task runs)
#   perl tools/real-video/index/sync.pl --once   one sync now, then stop (a test); --dry: only print what would go online
#
# Only the picks go online: each clip's video id, times, its line with the lines around it, the phrase searched,
# channel and title, like the clips in docs/real-video/words/. Never the index itself (it stays private, on this PC).
#
# How: a small clone of the repo (only docs/real-video/picks) in the data folder; after a change on the PC (and a
# quiet half minute), or when the online file changed (checked every 3 minutes), it merges the two (for each clip the
# newer change wins: an unlike or "back to the original times" counts as a change too), updates the index from the
# online side, writes the file and pushes it with the GitHub login already on this PC.
use strict; use warnings; use utf8;
# This script's folder, also when started as C:\...\sync.pl (FindBin gets that wrong in Git Bash's Perl).
our $BIN; BEGIN { ($BIN = __FILE__) =~ tr{\\}{/}; $BIN =~ s{/[^/]*$}{} or $BIN = '.'; unshift @INC, $BIN }
use CaptionIndex;
use JSON::PP; use Fcntl qw(:flock); use POSIX qw(strftime); use List::Util qw(max first);
binmode STDOUT, ':encoding(UTF-8)'; binmode STDERR, ':encoding(UTF-8)';
$| = 1;

my $URL = 'https://github.com/Kiril-Tishko/craneberries.git';
my $BRANCH = 'claude/vigilant-ptolemy-ltawsa';
my $PATH = 'docs/real-video/picks/picks.json';
my $DIR = data_dir();
my $CLONE = "$DIR/sync-repo";
my $ONCE = grep { $_ eq '--once' || $_ eq '--dry' } @ARGV;
my $DRY = grep { $_ eq '--dry' } @ARGV;   # --dry: print what would go online, change nothing
my $GIT = first { -x $_ } (map { "$_/git.exe" } split /;/, $ENV{PATH} // ''), (map { "$_/git" } split /:/, $ENV{PATH} // ''),
  'C:/Program Files/Git/cmd/git.exe', '/mingw64/bin/git';
die "git not found\n" unless $GIT;

open my $lock, '>>', "$DIR/sync.lock" or die "can't open $DIR/sync.lock: $!\n";
if (!flock($lock, $ONCE ? LOCK_EX : LOCK_EX | LOCK_NB)) { print "The sync is already running.\n"; exit 0 }

# The page's tables (site.pl makes them too; whichever starts first).
sql("CREATE TABLE IF NOT EXISTS marks(lid INTEGER PRIMARY KEY, last INTEGER, kind TEXT NOT NULL, query TEXT, at INTEGER);");
sql("CREATE TABLE IF NOT EXISTS times(lid INTEGER PRIMARY KEY, s REAL NOT NULL, e REAL NOT NULL, at INTEGER);");
sql('ALTER TABLE times ADD COLUMN last INTEGER;') unless grep { $_->[1] eq 'last' } sql('PRAGMA table_info(times);');

sub logl {
  my $m = strftime('%m-%d %H:%M:%S', localtime) . "  @_\n";
  print $m;
  open my $h, '>>:encoding(UTF-8)', "$DIR/sync.log" or return; print $h $m;
}
sub git {   # runs git in the clone; returns (exit code, output)
  my @a = @_;
  my $out = "$DIR/tmp/git.out";
  mkdir "$DIR/tmp";
  my $pid = fork // die "fork: $!\n";
  if (!$pid) {
    open STDIN, '<', '/dev/null'; open STDOUT, '>', $out; open STDERR, '>&', \*STDOUT;
    $ENV{GIT_TERMINAL_PROMPT} = '0';   # never wait for a password: the login is in Windows' credential store
    exec $GIT, (-d "$CLONE/.git" ? ('-C', $CLONE) : ()), @a or POSIX::_exit(127);
  }
  waitpid $pid, 0;
  (($? >> 8), slurp($out));
}
sub ensure_clone {
  return 1 if -d "$CLONE/.git";
  logl("making the small clone in $CLONE");
  my ($rc, $o) = git('clone', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', $BRANCH, $URL, $CLONE);
  if ($rc) { logl("clone failed: $o"); return 0 }
  git('sparse-checkout', 'set', 'docs/real-video/picks');
  git('config', 'user.name', 'caption-index sync');
  git('config', 'user.email', 'caption-index-sync@users.noreply.github.com');
  1;
}

# ---- the picks on the PC ----
# Every clip he liked, unliked, re-timed or set back: liked / timed, and when it last changed.
sub local_state {
  my %p;
  for my $r (sql("SELECT x.lid, m.last, m.kind, ifnull(m.query,''), ifnull(m.at,0), t.last, t.s, t.e, ifnull(t.at,0)
      FROM (SELECT lid FROM marks WHERE kind IN ('keep','none') UNION SELECT lid FROM times) x
      LEFT JOIN marks m ON m.lid = x.lid LEFT JOIN times t ON t.lid = x.lid;")) {
    my ($lid, $mlast, $kind, $q, $mat, $tlast, $s, $e, $tat) = @$r;
    $p{$lid} = {id => "$lid", last => 0 + ($mlast || $tlast || $lid), q => $q, liked => ($kind // '') eq 'keep' ? 1 : 0,
      timed => (length($s // '') && $s >= 0) ? 1 : 0, s => (length($s // '') && $s >= 0 ? 0 + $s : undef),
      e => (length($e // '') && $s >= 0 ? 0 + $e : undef), at => max(0 + $mat, 0 + $tat)};
  }
  %p;
}
# A pick as it goes online: the clip with its line and lines around (from the index), his times where he moved them.
sub entry {
  my $p = shift;
  my ($lid, $last) = ($p->{id}, $p->{last});
  my $k = int($lid / 100000);
  return unless int($last / 100000) == $k && $last >= $lid && $last - $lid <= 3;
  my ($v) = sql("SELECT v.id, ifnull(v.title,''), ifnull(c.name, v.channel), ifnull(c.show,''), ifnull(v.kind,'') FROM videos v LEFT JOIN channels c ON c.key = v.channel WHERE v.k = $k;");
  return unless $v;
  my %by = map { $_->[0] => $_ } sql(sprintf "SELECT id, s, e, text FROM lines WHERE id BETWEEN %d AND %d;", max($k * 100000, $lid - 2), $last + 2);
  return unless $by{$lid} && $by{$last};
  my $sec = sub { 0 + sprintf('%.2f', $_[0] / 1000) };
  my ($s0, $e0) = ($sec->($by{$lid}[1]), $sec->($by{$last}[2]));
  {id => "$lid", last => 0 + $last, q => $p->{q}, liked => $p->{liked} ? JSON::PP::true : JSON::PP::false,
   timed => $p->{timed} ? JSON::PP::true : JSON::PP::false, at => 0 + $p->{at},
   v => $v->[0], s => $p->{timed} ? $p->{s} : $s0, e => $p->{timed} ? $p->{e} : $e0, s0 => $s0, e0 => $e0,
   line => join(' ', map { $by{$_}[3] } $lid .. $last),
   around => [map { my $r = $by{$_}; $r ? [$sec->($r->[1]), $sec->($r->[2]), $r->[3]] : () } $lid - 2, $lid - 1, $last + 1, $last + 2],
   channel => $v->[2], show => $v->[3], title => $v->[1], kind => $v->[4],
   # A song's lines are lyrics: never in the repo (CLAUDE.md), so a song pick goes online with its times only.
   ($v->[3] =~ /^Songs\b/ ? (song => JSON::PP::true, line => "\x{266A}", around => []) : ())};
}
# A change made online (newer than the PC's) goes into the index.
sub apply_remote {
  my $r = shift;
  my ($lid, $last, $at) = map { int($_ // 0) } @$r{qw(id last at)};
  return unless $lid;
  $last ||= $lid;
  my $q = sql_quote($r->{q} // '');
  my @s = ('BEGIN;');
  push @s, sprintf "INSERT INTO marks(lid, last, kind, query, at) VALUES(%d, %d, '%s', %s, %d) ON CONFLICT(lid) DO UPDATE SET kind=excluded.kind, at=excluded.at, last=excluded.last;",
    $lid, $last, ($r->{liked} ? 'keep' : 'none'), $q, $at;
  if ($r->{timed} && defined $r->{s} && defined $r->{e} && $r->{e} > $r->{s}) {
    push @s, sprintf "INSERT OR REPLACE INTO times(lid, s, e, at, last) VALUES(%d, %.2f, %.2f, %d, %d);", $lid, $r->{s}, $r->{e}, $at, $last;
  } else {
    push @s, sprintf "UPDATE times SET s=-1, e=-1, at=%d WHERE lid=%d;", $at, $lid;
  }
  push @s, 'COMMIT;';
  sql(join "\n", @s);
}
sub fingerprint { my %p = local_state(); join ',', map { "$_:$p{$_}{at}:$p{$_}{liked}:$p{$_}{timed}" } sort keys %p }

# ---- one sync ----
sub file_text {   # one clip per line, newest first within each searched phrase
  my @c = sort { lc($a->{q}) cmp lc($b->{q}) || $b->{at} <=> $a->{at} } @_;
  my $J = JSON::PP->new->canonical;
  "{\n  \"_\": \"His picks from the private caption index (his PC syncs this file both ways; edit it only through the picks page). One clip per line: id = the line in his index, q = the phrase he searched, liked, timed = his own start / end (s0 / e0 = the captions' own), at = last change.\",\n" .
  "  \"clips\": [\n" . join(",\n", map { '    ' . $J->encode($_) } @c) . "\n  ]\n}\n";
}
sub sync_once {
  return 0 unless ensure_clone();
  for my $try (1 .. 3) {
    my ($rc, $o) = git('fetch', '--depth', '1', 'origin', $BRANCH);
    if ($rc) { logl("fetch failed: $o"); return 0 }
    git('reset', '--hard', 'FETCH_HEAD');
    my $file = "$CLONE/$PATH";
    my $old = -e $file ? slurp($file) : '';
    my $doc = length $old ? eval { JSON::PP->new->decode($old) } : {};
    my %remote = map { $_->{id} => $_ } grep { ref eq 'HASH' && $_->{id} } @{($doc || {})->{clips} || []};
    my %local = local_state();
    my $in = 0;
    for my $id (keys %remote) {
      my $r = $remote{$id};
      next if $local{$id} && ($local{$id}{at} // 0) >= ($r->{at} // 0);
      $in++; next if $DRY;
      apply_remote($r);
    }
    %local = local_state() if $in;
    my @out = grep { defined } map { entry($_) } grep { $_->{liked} || $_->{timed} } values %local;
    # A clip online that the index can't show (should not happen) stays as it is.
    my %have = map { $_->{id} => 1 } @out;
    push @out, grep { !$have{$_->{id}} && !$local{$_->{id}} && ($_->{liked} || $_->{timed}) } values %remote;
    my $text = file_text(@out);
    if ($DRY) { print $text; return 1 }
    state_set_sync(merged => git_blob());
    if ($text eq $old) { logl("in sync ($in from online)") if $in; return 1 }
    mkdir "$CLONE/docs"; mkdir "$CLONE/docs/real-video"; mkdir "$CLONE/docs/real-video/picks";
    open my $h, '>:raw', $file or do { logl("can't write $file: $!"); return 0 };
    my $t = $text; utf8::encode($t); print $h $t; close $h;
    my $liked = grep { $_->{liked} } @out; my $timed = grep { $_->{timed} } @out;
    git('add', $PATH);
    ($rc, $o) = git('commit', '-q', '-m', "Caption index picks: $liked liked, $timed re-timed (synced from his PC)");
    ($rc, $o) = git('push', '-q', 'origin', "HEAD:$BRANCH");
    if (!$rc) { logl(sprintf 'pushed: %d liked, %d re-timed%s', $liked, $timed, $in ? " ($in changes from online)" : ''); state_set_sync(merged => git_blob()); return 1 }
    logl("push refused (try $try): $o");
    sleep 5;
  }
  0;
}
sub git_blob { my ($rc, $o) = git('rev-parse', "HEAD:$PATH"); $rc ? '' : ($o =~ /([0-9a-f]{40})/)[0] // '' }
sub remote_blob {
  my ($rc, $o) = git('fetch', '--depth', '1', 'origin', $BRANCH);
  return undef if $rc;
  ($rc, $o) = git('rev-parse', "FETCH_HEAD:$PATH");
  $rc ? '' : ($o =~ /([0-9a-f]{40})/)[0] // '';
}
sub state_get { my $s = eval { JSON::PP->new->decode(slurp("$DIR/sync-state.json")) }; ref $s eq 'HASH' ? $s : {} }
sub state_set_sync { my %kv = @_; my $s = state_get(); @$s{keys %kv} = values %kv; open my $h, '>', "$DIR/sync-state.json" or return; print $h JSON::PP->new->canonical->encode($s) }

# ---- the loop ----
if ($ONCE) { exit(sync_once() ? 0 : 1) }
logl('started');
my ($seen, $since, $last_remote) = (fingerprint(), 0, 0);
my $done = state_get()->{done_fp} // '';
while (1) {
  # This program changed (collect.pl --install): stop; the task starts the new one.
  my $me = (stat __FILE__)[9] // 0;
  our $born //= $me;
  exit 0 if $me != $born;
  my $fp = eval { fingerprint() } // $seen;
  if ($fp ne $seen) { $seen = $fp; $since = time }
  my $want = $fp ne $done && time - $since >= 30;
  if (!$want && time - $last_remote >= 180) {
    $last_remote = time;
    my $b = ensure_clone() ? remote_blob() : undef;
    $want = defined $b && $b ne (state_get()->{merged} // '');
  }
  if ($want && eval { sync_once() }) { $done = fingerprint(); $seen = $done; state_set_sync(done_fp => $done) }
  elsif ($@) { logl("error: $@") }
  sleep 10;
}
