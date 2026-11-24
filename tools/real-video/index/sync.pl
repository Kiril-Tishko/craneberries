#!/usr/bin/env perl
# His picks online: keeps docs/real-video/picks/picks.json on GitHub the same as the caption index on his PC, both
# ways. Picks = every clip he ♥ liked, every clip whose start / end he moved and every clip whose caption lines he
# edited, on the page (site.html) or online
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
use JSON::PP; use Fcntl qw(:flock); use POSIX qw(strftime); use List::Util qw(max first); use File::Path qw(remove_tree);
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
page_tables();

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
# The small clone can break when the PC goes off while git writes a file (Nov 23: a branch file full of zeros, and
# every fetch failed for a day). It is only a copy (his picks live in the index and online), so it is made again.
my $BROKEN = qr/reference broken|cannot lock ref|bad object|corrupt|not a git repository|unable to read|invalid (?:object|sha1|reference)|bad signature|index file/i;
sub fetch_branch {
  my ($rc, $o) = git('fetch', '--depth', '1', 'origin', $BRANCH);
  if ($rc && $o =~ $BROKEN) {
    logl('the small clone is broken (' . ((grep { /$BROKEN/ } split /\n/, $o)[0] // '?') . '): making it again');
    my $old = "$CLONE-broken";
    remove_tree($old) if -d $old;
    rename($CLONE, $old) or remove_tree($CLONE);
    remove_tree($old) if -d $old;
    return (1, 'the clone could not be made again') unless ensure_clone();
    ($rc, $o) = git('fetch', '--depth', '1', 'origin', $BRANCH);
  }
  ($rc, $o);
}

# ---- the picks on the PC ----
# Every clip he liked, unliked, re-timed, edited or set back: liked / timed / edited, and when it last changed.
sub local_state {
  my %p;
  for my $r (sql("SELECT x.lid, m.last, m.kind, ifnull(m.query,''), ifnull(m.at,0), t.last, t.s, t.e, ifnull(t.at,0),
      c.last, length(ifnull(c.data,'')), ifnull(c.at,0)
      FROM (SELECT lid FROM marks WHERE kind IN ('keep','super','none') UNION SELECT lid FROM times UNION SELECT lid FROM caps) x
      LEFT JOIN marks m ON m.lid = x.lid LEFT JOIN times t ON t.lid = x.lid LEFT JOIN caps c ON c.lid = x.lid;")) {
    my ($lid, $mlast, $kind, $q, $mat, $tlast, $s, $e, $tat, $clast, $clen, $cat) = @$r;
    $p{$lid} = {id => "$lid", last => 0 + ($mlast || $tlast || $clast || $lid), q => $q, liked => (($kind // '') eq 'keep' || ($kind // '') eq 'super') ? 1 : 0, super => ($kind // '') eq 'super' ? 1 : 0,
      timed => (length($s // '') && $s >= 0) ? 1 : 0, edited => ($clen || 0) > 0 ? 1 : 0, at => max(0 + $mat, 0 + $tat, 0 + $cat)};
  }
  %p;
}
# A pick as it goes online: the clip with its line and lines around (his edited ones where he changed them, with the
# index's own as orig), his times where he moved them (s0 / e0 = the clip line's own).
sub entry {
  my $p = shift;
  my $c = clip_view($p->{id}, $p->{last}) or return;
  my $song = $c->{show} =~ /^Songs\b/;
  my $B = sub { $_[0] ? JSON::PP::true : JSON::PP::false };
  {id => "$p->{id}", last => 0 + $c->{last}, q => $p->{q}, liked => $B->($p->{liked}), super => $B->($p->{super}), timed => $B->($c->{timed}),
   edited => $B->($c->{edited} && !$song), at => 0 + $p->{at},
   v => $c->{v}, s => $c->{s}, e => $c->{e}, s0 => $c->{s0}, e0 => $c->{e0}, line => $c->{line}, around => $c->{around},
   ($c->{edited} && !$song ? (orig => $c->{orig}) : ()),
   channel => $c->{channel}, show => $c->{show}, title => $c->{title}, kind => $c->{kind},
   # A song's lines are lyrics: never in the repo (CLAUDE.md), so a song pick goes online with its times only.
   ($song ? (song => JSON::PP::true, line => "\x{266A}", around => []) : ())};
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
    $lid, $last, ($r->{liked} ? ($r->{super} ? 'super' : 'keep') : 'none'), $q, $at;
  if ($r->{timed} && defined $r->{s} && defined $r->{e} && $r->{e} > $r->{s}) {
    push @s, sprintf "INSERT OR REPLACE INTO times(lid, s, e, at, last) VALUES(%d, %.2f, %.2f, %d, %d);", $lid, $r->{s}, $r->{e}, $at, $last;
  } else {
    push @s, sprintf "UPDATE times SET s=-1, e=-1, at=%d WHERE lid=%d;", $at, $lid;
  }
  # His caption lines (never for a song: its lines stay on the PC): the clip's line at its own times (s0 / e0) among
  # the lines around it, in time order.
  if (!$r->{song}) {
    my $d;
    if ($r->{edited} && defined $r->{line} && !ref $r->{line} && ref $r->{around} eq 'ARRAY') {
      my $own = [$r->{s0} // $r->{s}, $r->{e0} // $r->{e}, $r->{line}];
      my @l = sort { $a->[0] <=> $b->[0] || ($a == $own ? -1 : $b == $own ? 1 : 0) } $own, grep { ref eq 'ARRAY' && @$_ >= 3 } @{$r->{around}};
      my ($ci) = grep { $l[$_] == $own } 0 .. $#l;
      $d = clean_caps({clip => $ci, lines => [map { [@$_[0 .. 2]] } @l]});
    }
    if ($d) { push @s, sprintf "INSERT OR REPLACE INTO caps(lid, last, data, at) VALUES(%d, %d, %s, %d);", $lid, $last, sql_quote(JSON::PP->new->canonical->encode($d)), $at }
    else { push @s, sprintf "UPDATE caps SET data=NULL, at=%d WHERE lid=%d;", $at, $lid }
  }
  push @s, 'COMMIT;';
  sql(join "\n", @s);
}
sub fingerprint { my %p = local_state(); join ',', map { "$_:$p{$_}{at}:$p{$_}{liked}:$p{$_}{super}:$p{$_}{timed}:$p{$_}{edited}" } sort keys %p }

# ---- one sync ----
sub file_text {   # one clip per line, newest first within each searched phrase
  my @c = sort { lc($a->{q}) cmp lc($b->{q}) || $b->{at} <=> $a->{at} } @_;
  my $J = JSON::PP->new->canonical;
  "{\n  \"_\": \"His picks from the private caption index (his PC syncs this file both ways; edit it only through the picks page). One clip per line: id = the line in his index, q = the phrase he searched, liked, super = super liked (first in its searches), timed = his own start / end (s0 / e0 = the clip line's own), edited = his own caption lines (orig = the index's), at = last change.\",\n" .
  "  \"clips\": [\n" . join(",\n", map { '    ' . $J->encode($_) } @c) . "\n  ]\n}\n";
}
sub sync_once {
  return 0 unless ensure_clone();
  for my $try (1 .. 3) {
    my ($rc, $o) = fetch_branch();
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
    my @out = grep { defined } map { entry($_) } grep { $_->{liked} || $_->{timed} || $_->{edited} } values %local;
    # A clip online that the index can't show (should not happen) stays as it is.
    my %have = map { $_->{id} => 1 } @out;
    push @out, grep { !$have{$_->{id}} && !$local{$_->{id}} && ($_->{liked} || $_->{timed} || $_->{edited}) } values %remote;
    my $text = file_text(@out);
    if ($DRY) { print $text; return 1 }
    state_set_sync(merged => git_blob());
    if ($text eq $old) { logl("in sync ($in from online)") if $in; return 1 }
    mkdir "$CLONE/docs"; mkdir "$CLONE/docs/real-video"; mkdir "$CLONE/docs/real-video/picks";
    open my $h, '>:raw', $file or do { logl("can't write $file: $!"); return 0 };
    my $t = $text; utf8::encode($t); print $h $t; close $h;
    my $liked = grep { $_->{liked} } @out; my $timed = grep { $_->{timed} } @out; my $edited = grep { $_->{edited} } @out;
    my $super = grep { $_->{super} } @out;
    my $what = "$liked liked" . ($super ? " ($super super)" : '') . ", $timed re-timed" . ($edited ? ", $edited with his captions" : '');
    git('add', $PATH);
    ($rc, $o) = git('commit', '-q', '-m', "Caption index picks: $what (synced from his PC)");
    ($rc, $o) = git('push', '-q', 'origin', "HEAD:$BRANCH");
    if (!$rc) { logl(sprintf 'pushed: %s%s', $what, $in ? " ($in changes from online)" : ''); state_set_sync(merged => git_blob()); return 1 }
    logl("push refused (try $try): $o");
    sleep 5;
  }
  0;
}
sub git_blob { my ($rc, $o) = git('rev-parse', "HEAD:$PATH"); $rc ? '' : ($o =~ /([0-9a-f]{40})/)[0] // '' }
sub remote_blob {
  my ($rc, $o) = fetch_branch();
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
