#!/usr/bin/env perl
# The private caption index as a page on his PC: http://localhost:8770
# Search it (same as search.pl), play each clip at its second, copy a clip entry for docs/real-video/words/, and see
# how far the collector has got. The page is site.html; this small server answers it.
#
#   perl tools/real-video/index/site.pl [--port 8770]
# collect.pl --install also makes a hidden scheduled task, "Caption index page", that starts it at logon.
#
# Only this PC can open it (it listens on 127.0.0.1 and answers only to localhost): nothing is published anywhere,
# because the index stays private (YouTube's terms; see collect.pl).
use strict; use warnings; use utf8;
# This script's folder, also when started as C:\...\site.pl (FindBin gets that wrong in Git Bash's Perl).
our $BIN; BEGIN { ($BIN = __FILE__) =~ tr{\\}{/}; $BIN =~ s{/[^/]*$}{} or $BIN = '.'; unshift @INC, $BIN }
use CaptionIndex;
use IO::Socket::INET; use JSON::PP; use Fcntl qw(:flock); use IPC::Open3 qw(open3); use Symbol qw(gensym);
use List::Util qw(min max sum0); use POSIX qw(_exit);

$| = 1;
my $port = 8770;
while (@ARGV) { my $a = shift @ARGV; if ($a eq '--port') { $port = shift @ARGV } else { die "usage: perl site.pl [--port 8770]\n" } }
die "bad port\n" unless $port =~ /^\d+$/;

my $DIR = data_dir();
open my $lock, '>>', "$DIR/site.lock" or die "can't open $DIR/site.lock: $!\n";
if (!flock($lock, LOCK_EX | LOCK_NB)) { print "The page is already running: http://localhost:$port\n"; exit 0 }
my $srv = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $port, Listen => 20, ReuseAddr => 1, Proto => 'tcp')
  or die "can't listen on 127.0.0.1:$port: $@\n";
$SIG{CHLD} = 'IGNORE'; $SIG{PIPE} = 'IGNORE';
print "Caption index page: http://localhost:$port\n";

while (1) {
  my $c = $srv->accept or next;
  my $pid = fork;
  if (!defined $pid) { close $c; next }
  if ($pid) { close $c; next }
  # One child per connection, so a browser's idle spare connection never holds up the next one.
  close $srv;
  local $SIG{ALRM} = sub { _exit(0) };
  alarm 90;
  eval { handle($c) };
  close $c;
  _exit(0);
}

sub handle {
  my $c = shift;
  binmode $c; $c->autoflush(1);
  my $req = <$c> // return;
  my ($method, $target) = $req =~ m{^(\w+) (\S+) HTTP/} or return reply($c, 400, 'text/plain', 'bad request');
  my %h;
  while (defined(my $l = <$c>)) { last if $l =~ /^\r?\n$/; $h{lc $1} = $2 if $l =~ /^([^:]+):\s*(.*?)\r?\n$/ }
  # Only pages opened as localhost (stops another website from reading it through a DNS trick).
  return reply($c, 403, 'text/plain', 'only http://localhost') unless ($h{host} // '') =~ /^(localhost|127\.0\.0\.1)(:\d+)?$/i;
  return reply($c, 405, 'text/plain', 'GET only') unless $method eq 'GET';
  my ($path, $qs) = split /\?/, $target, 2;
  my %q = map { my ($k, $v) = split /=/, $_, 2; (unesc($k) => unesc($v // '')) } grep { length } split /&/, $qs // '';
  if ($path eq '/') {
    my $html = slurp("$BIN/site.html");
    return reply($c, 500, 'text/plain', "site.html is missing next to site.pl") unless length $html;
    utf8::encode($html);
    return reply($c, 200, 'text/html; charset=utf-8', $html);
  }
  return json($c, status()) if $path eq '/api/status';
  return json($c, search(\%q)) if $path eq '/api/search';
  return reply($c, 204, 'text/plain', '') if $path eq '/favicon.ico';
  reply($c, 404, 'text/plain', 'not found');
}

sub unesc { my $s = shift; $s =~ tr/+/ /; $s =~ s/%([0-9A-Fa-f]{2})/chr hex $1/ge; $s }   # bytes (UTF-8)

sub reply {
  my ($c, $code, $type, $body) = @_;
  my %text = (200 => 'OK', 204 => 'No Content', 400 => 'Bad Request', 403 => 'Forbidden', 404 => 'Not Found', 405 => 'Method Not Allowed', 500 => 'Server Error');
  print $c "HTTP/1.1 $code " . ($text{$code} // 'OK') . "\r\nContent-Type: $type\r\nContent-Length: " . length($body) .
    "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nConnection: close\r\n\r\n$body";
}
sub json { my ($c, $d) = @_; reply($c, 200, 'application/json; charset=utf-8', JSON::PP->new->utf8->canonical->encode($d)) }

# search.pl --json does the work, so the page and the command line always find the same clips.
sub search {
  my $q = shift;
  my $text = $q->{q} // '';
  return {error => 'Type a word or phrase.'} unless $text =~ /\S/;
  my $n = ($q->{n} // '') =~ /^\d+$/ ? min(50, max(1, $q->{n})) : 10;
  my @args = ($text, $n, '--json');
  push @args, '--page', $q->{page} if ($q->{page} // '') =~ /^\d+$/;
  push @args, '--show', $q->{show} if length($q->{show} // '');
  push @args, '--channel', $q->{channel} if length($q->{channel} // '');
  push @args, '--human' if $q->{human};
  my $err = gensym;
  my $pid = open3(my $in, my $out, $err, $^X, "$BIN/search.pl", @args);
  close $in;
  my $o = do { local $/; <$out> } // ''; my $e = do { local $/; <$err> } // '';
  waitpid $pid, 0;
  my $d = $o =~ /^\{/ ? eval { JSON::PP->new->utf8->decode($o) } : undef;
  return $d if $d;
  $e =~ s/\s+$//; utf8::decode($e);
  {error => ($e || 'The search failed.')};
}

sub status {
  my %n = map { $_->[0] => 0 + $_->[1] } sql("SELECT status, count(*) FROM videos GROUP BY status;");
  my %k = map { $_->[0] => 0 + $_->[1] } sql("SELECT kind, count(*) FROM videos WHERE status='done' GROUP BY kind;");
  my ($lines, $hours) = map { (0 + ($_->[0] || 0), 0 + ($_->[1] || 0)) } sql("SELECT sum(lines), round(sum(dur) / 3600.0, 1) FROM videos WHERE status='done';");
  my ($listed, $all) = map { (0 + $_->[0], 0 + $_->[1]) } sql("SELECT count(listed_at), count(*) FROM channels;");
  my ($last_hour) = map { 0 + $_->[0] } sql(sprintf "SELECT count(*) FROM videos WHERE fetched_at > %d;", time - 3600);
  my $has_show = grep { $_->[1] eq 'show' } sql('PRAGMA table_info(channels);');
  my @shows = $has_show ? map { {show => $_->[0], videos => 0 + ($_->[1] || 0), human => 0 + ($_->[2] || 0), hours => 0 + ($_->[3] || 0), todo => 0 + ($_->[4] || 0)} }
    sql("SELECT c.show, sum(v.status='done'), sum(v.status='done' AND v.kind='human'), round(sum(CASE WHEN v.status='done' THEN v.dur END) / 3600.0, 1), sum(v.status='todo') FROM channels c LEFT JOIN videos v ON v.channel=c.key WHERE ifnull(c.show,'') <> '' GROUP BY c.show ORDER BY c.show;") : ();
  my @channels = map { {name => $_->[0], videos => 0 + ($_->[1] || 0), todo => 0 + ($_->[2] || 0)} }
    sql("SELECT c.name, sum(v.status='done'), sum(v.status='todo') FROM channels c LEFT JOIN videos v ON v.channel=c.key GROUP BY c.key ORDER BY c.rowid;");
  my $s = read_state();
  my $running = do { open my $l, '>>', "$DIR/collector.lock"; my $free = $l && flock($l, LOCK_EX | LOCK_NB); flock($l, LOCK_UN) if $free; $l && !$free };
  my $db = db_path();
  {videos => $n{done} // 0, human => $k{human} // 0, auto => $k{auto} // 0, lines => $lines, hours => $hours,
   todo => $n{todo} // 0, none => $n{none} // 0, gone => $n{gone} // 0, failed => $n{error} // 0,
   channels_listed => $listed, channels => $all, last_hour => $last_hour,
   running => ($running ? JSON::PP::true : JSON::PP::false), stopped => (-e "$DIR/stop" ? JSON::PP::true : JSON::PP::false),
   paused_until => (($s->{paused_until} // 0) > time ? 0 + $s->{paused_until} : undef),
   pause_reason => (($s->{paused_until} // 0) > time ? $s->{pause_reason} : undef),
   last_video_at => $s->{last_video_at}, last_video => $s->{last_video},
   round_n => $s->{round_n}, round_size => $s->{round_size}, gap => $s->{gap},
   mb => 0 + sprintf('%.0f', sum0(map { -s $_ // 0 } $db, "$db-wal") / 1e6),
   shows => \@shows, channel_list => \@channels};
}
