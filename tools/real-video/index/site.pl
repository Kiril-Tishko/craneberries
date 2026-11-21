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
use List::Util qw(min max sum0 first); use POSIX qw(_exit);

$| = 1;
my $port = 8770;
while (@ARGV) { my $a = shift @ARGV; if ($a eq '--port') { $port = shift @ARGV } else { die "usage: perl site.pl [--port 8770]\n" } }
die "bad port\n" unless $port =~ /^\d+$/;

my $DIR = data_dir();
# The clip library's player (see sub player): the installed copy next to this script, else the repo's docs/real-video.
my $PLAYER = -d "$BIN/player" ? "$BIN/player" : "$BIN/../../../docs/real-video";
my $LIVE = 'https://kiril-tishko.github.io/craneberries/real-video/';   # the live clip library (sub player_file)
open my $lock, '>>', "$DIR/site-$port.lock" or die "can't open $DIR/site-$port.lock: $!\n";   # one copy a port
if (!flock($lock, LOCK_EX | LOCK_NB)) {
  # Another copy has the port. If it answers, it is running; if not, it hung while starting (once, Nov 21, when
  # --install restarted everything): stop it and take its place, so the hourly task mends the page by itself.
  if (IO::Socket::INET->new(PeerAddr => '127.0.0.1', PeerPort => $port, Timeout => 3)) { print "The page is already running: http://localhost:$port\n"; exit 0 }
  my $old = slurp("$DIR/site-$port.pid") =~ /(\d+)/ ? $1 : 0;
  kill 'KILL', $old if $old && $old != $$;
  my $got = 0;
  for (1 .. 20) { if (flock($lock, LOCK_EX | LOCK_NB)) { $got = 1; last } select undef, undef, undef, 0.5 }
  if (!$got) { print "The page's port is taken by a copy that doesn't answer (pid $old).\n"; exit 1 }
}
if (open my $pf, '>', "$DIR/site-$port.pid") { print $pf "$$\n"; close $pf }   # for the check above
# ♥ kept and 🙈 hidden clips, his own start / end, his edited caption lines (CaptionIndex.pm: page_tables).
page_tables();
# His phone on the home Wi-Fi may open it too (his wish, Nov 21), with a PIN: it listens on every network, but answers
# only this PC and devices on the private home network (10.x, 172.16-31.x, 192.168.x), and those only after the PIN.
# Windows asks once whether perl may accept connections: "Allow" on private networks only.
my $PIN = secret('site-pin.txt', sub { sprintf '%06d', rand_int(1_000_000) });
my $TOKEN = secret('site-token.txt', sub { join '', map { sprintf '%02x', rand_int(256) } 1 .. 20 });
my $srv = IO::Socket::INET->new(LocalAddr => '0.0.0.0', LocalPort => $port, Listen => 20, ReuseAddr => 1, Proto => 'tcp')
  or die "can't listen on port $port: $@\n";
$SIG{CHLD} = 'IGNORE'; $SIG{PIPE} = 'IGNORE';
print "Caption index page: http://localhost:$port (phone on the home Wi-Fi: http://" . (lan_ip() // '?') . ":$port, PIN $PIN)\n";

sub rand_int {   # from the system's random source when there is one
  my $n = shift;
  if (open my $r, '<:raw', '/dev/urandom') { read $r, my $b, 4; return unpack('N', $b) % $n }
  int rand $n;
}
sub secret {   # a small file in the data folder, made once
  my ($name, $make) = @_;
  my $f = "$DIR/$name";
  my $v = slurp($f); $v =~ s/\s+//g;
  return $v if length $v;
  $v = $make->();
  open my $h, '>', $f or die "can't write $f: $!\n"; print $h "$v\n"; close $h;
  $v;
}
# This PC's address on the home network (no packet is sent: a UDP "connect" only picks the way out).
sub lan_ip {
  my $s = IO::Socket::INET->new(PeerAddr => '192.168.0.1', PeerPort => 9, Proto => 'udp') or return;
  my $ip = $s->sockhost;
  $ip && $ip ne '0.0.0.0' && private($ip) ? $ip : undef;
}
# The home network, and Tailscale (100.64-127.x.x: his own devices, from anywhere, after the PIN).
sub private { (shift // '') =~ /^(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/ }

while (1) {
  my $c = $srv->accept or next;
  my $pid = fork;
  if (!defined $pid) { close $c; next }
  if ($pid) { close $c; next }
  # One child per connection, so a browser's idle spare connection never holds up the next one.
  close $srv;
  $SIG{CHLD} = 'DEFAULT';   # this child waits for its own programs (curl, search.pl) and needs their exit codes
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
  # Only this PC and the home network; only addresses as the page's name (stops another website from reading it
  # through a DNS trick).
  my $peer = $c->peerhost // '';
  my $local = $peer eq '127.0.0.1' || $peer eq '::1';
  return reply($c, 403, 'text/plain', 'only this PC and the home network') unless $local || private($peer);
  (my $host = $h{host} // '') =~ s/:\d+$//;
  return reply($c, 403, 'text/plain', 'open it as http://localhost') unless $host =~ /^(localhost|127\.0\.0\.1)$/i || private($host) || $host =~ /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i;   # *.ts.net: Tailscale's names
  return reply($c, 405, 'text/plain', 'GET only') unless $method eq 'GET';
  my ($path, $qs) = split /\?/, $target, 2;
  my %q = map { my ($k, $v) = split /=/, $_, 2; (unesc($k) => unesc($v // '')) } grep { length } split /&/, $qs // '';
  # Another device (his phone): the PIN first, then a cookie keeps it signed in for 30 days.
  if (!$local) {
    my %ck = map { /^\s*([^=]+)=(.*)$/ ? ($1 => $2) : () } split /;/, $h{cookie} // '';
    return login($c, \%q, $path) unless ($ck{ci} // '') eq $TOKEN;
  }
  # Changes come only from the page's own script (another website can't send this header to it).
  return reply($c, 403, 'text/plain', 'from the page only') if $path =~ m{^/api/(mark|times|caps)} && ($h{'x-ci'} // '') ne '1';
  return json($c, mark(\%q)) if $path eq '/api/mark';
  return json($c, set_times(\%q)) if $path eq '/api/times';
  return json($c, set_caps(\%q)) if $path eq '/api/caps';
  return script($c) if $path eq '/caps.js';
  return json($c, kept()) if $path eq '/api/kept';
  if ($path eq '/') {
    my $html = slurp("$BIN/site.html");
    return reply($c, 500, 'text/plain', "site.html is missing next to site.pl") unless length $html;
    utf8::encode($html);
    return reply($c, 200, 'text/html; charset=utf-8', $html);
  }
  return json($c, status()) if $path eq '/api/status';
  return json($c, search(\%q)) if $path eq '/api/search';
  return player($c, $1 // '/') if $path =~ m{^/player(/.*)?$};
  return reply($c, 204, 'text/plain', '') if $path eq '/favicon.ico';
  reply($c, 404, 'text/plain', 'not found');
}

sub unesc { my $s = shift; $s =~ tr/+/ /; $s =~ s/%([0-9A-Fa-f]{2})/chr hex $1/ge; $s }   # bytes (UTF-8)

sub reply {
  my ($c, $code, $type, $body, @extra) = @_;
  my %text = (200 => 'OK', 204 => 'No Content', 303 => 'See Other', 400 => 'Bad Request', 401 => 'Unauthorized', 403 => 'Forbidden', 404 => 'Not Found', 405 => 'Method Not Allowed', 429 => 'Too Many Requests', 500 => 'Server Error');
  print $c "HTTP/1.1 $code " . ($text{$code} // 'OK') . "\r\nContent-Type: $type\r\nContent-Length: " . length($body) .
    "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: strict-origin-when-cross-origin\r\n" .
    join('', map { "$_\r\n" } @extra) . "Connection: close\r\n\r\n$body";
}

# The PIN page for another device. Five wrong PINs in a row: no more tries for 15 minutes.
sub login {
  my ($c, $q, $path) = @_;
  my $f = "$DIR/site-fails.json";
  open my $fh, '+>>', $f or return reply($c, 500, 'text/plain', "can't open $f");
  flock($fh, LOCK_EX); seek $fh, 0, 0;
  my $st = eval { JSON::PP->new->decode(do { local $/; <$fh> } // '') } || {n => 0, until => 0};
  my $save = sub { seek $fh, 0, 0; truncate $fh, 0; print $fh JSON::PP->new->encode($st) };
  my $msg = '';
  if ($path eq '/login' && defined $q->{pin}) {
    if (($st->{until} // 0) > time) { $msg = sprintf 'Too many wrong PINs. Try again in %d minutes.', ($st->{until} - time) / 60 + 1 }
    elsif ($q->{pin} =~ /^\s*\Q$PIN\E\s*$/) {
      $st = {n => 0, until => 0}; $save->(); close $fh;
      return reply($c, 303, 'text/plain', 'ok', 'Location: /', "Set-Cookie: ci=$TOKEN; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict");
    }
    else {
      $st->{n}++;
      if ($st->{n} >= 5) { $st = {n => 0, until => time + 900}; $msg = 'Too many wrong PINs. Try again in 15 minutes.' }
      else { $msg = 'That PIN is not right.' }
      $save->();
    }
  }
  close $fh;
  return reply($c, 401, 'application/json; charset=utf-8', '{"error":"PIN needed: open the page again"}') if $path =~ m{^/(api|player)/};
  my $html = <<"HTML";
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Caption Index</title><style>body{margin:0;font:17px/1.4 system-ui,sans-serif;background:#141517;color:#ececec;display:grid;place-items:center;min-height:100vh}
form{background:#1d1f22;border:1px solid #2d3034;border-radius:14px;padding:22px;width:min(92vw,340px)}h1{font-size:20px;margin:0 0 6px}
p{color:#a9adb3;font-size:14px;margin:0 0 14px}input{font:inherit;font-size:24px;letter-spacing:.2em;width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #2d3034;background:#141517;color:#ececec;text-align:center}
button{margin-top:12px;width:100%;font:inherit;padding:11px;border:0;border-radius:10px;background:#7aa2ff;color:#0f1115}.e{color:#ff8a80;font-size:14px;margin-top:10px}</style></head>
<body><form method="get" action="/login"><h1>Caption index</h1><p>Type the PIN shown on the page on your PC.</p>
<input name="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus aria-label="PIN"><button>Open</button>
@{[ $msg ? qq{<div class="e">$msg</div>} : '' ]}</form></body></html>
HTML
  utf8::encode($html);
  reply($c, 401, 'text/html; charset=utf-8', $html);
}

# ⭐ keep / 🙈 hide / none (undo) a clip. Hide covers the same scene in the other videos too (scene = their lines).
sub mark {
  my $q = shift;
  my $kind = $q->{kind} // '';
  my $lid = ($q->{lid} // '') =~ /^\d+$/ ? $q->{lid} : return {error => 'no clip'};
  my $last = ($q->{last} // '') =~ /^\d+$/ ? $q->{last} : $lid;
  my @lids = ($lid, grep { /^\d+$/ } split /,/, $q->{scene} // '');
  my $query = sql_quote(do { my $t = $q->{q} // ''; utf8::decode($t); $t });
  # Undone marks stay as kind 'none' with their time, so the sync with the online copy knows which side is newer.
  if ($kind eq 'none') { sql(join "\n", 'BEGIN;', (map { sprintf "INSERT INTO marks(lid, last, kind, query, at) VALUES(%d, %d, 'none', %s, %d) ON CONFLICT(lid) DO UPDATE SET kind='none', at=excluded.at;", $_, $_ == $lid ? $last : $_, $query, time } @lids), 'COMMIT;') }
  elsif ($kind eq 'keep') { sql(sprintf "INSERT OR REPLACE INTO marks(lid, last, kind, query, at) VALUES(%d, %d, 'keep', %s, %d);", $lid, $last, $query, time) }
  elsif ($kind eq 'hide') { sql(join "\n", 'BEGIN;', (map { sprintf "INSERT OR REPLACE INTO marks(lid, last, kind, query, at) VALUES(%d, %d, 'hide', %s, %d);", $_, $_ == $lid ? $last : $_, $query, time } @lids), 'COMMIT;') }
  else { return {error => 'keep, hide or none'} }
  {ok => JSON::PP::true, kind => $kind};
}

# A clip's start and end, moved on the page (s, e in seconds), or back to the captions' own (reset=1).
sub set_times {
  my $q = shift;
  my $lid = ($q->{lid} // '') =~ /^\d+$/ ? $q->{lid} : return {error => 'no clip'};
  my $last = ($q->{last} // '') =~ /^\d+$/ ? $q->{last} : $lid;
  # Back to the original times: kept as s = e = -1 with its time (for the sync), not deleted.
  if ($q->{reset}) { sql(sprintf "INSERT OR REPLACE INTO times(lid, s, e, at, last) VALUES(%d, -1, -1, %d, %d);", $lid, time, $last); return {ok => JSON::PP::true} }
  my ($s, $e) = map { ($q->{$_} // '') =~ /^\d+(?:\.\d+)?$/ ? $q->{$_} : undef } qw(s e);
  return {error => 'start and end in seconds'} unless defined $s && defined $e && $e > $s;
  sql(sprintf "INSERT OR REPLACE INTO times(lid, s, e, at, last) VALUES(%d, %.2f, %.2f, %d, %d);", $lid, $s, $e, time, $last);
  {ok => JSON::PP::true};
}

# A clip's caption lines as he edited them on the page (data = {"clip": n, "lines": [[s, e, text, word times], …]}),
# or back to the index's own (reset=1). His start / end, if he had moved them, are in the edited lines from now on
# (the editor starts from them), so they are set back; −/+ after this makes new ones. Answers with the clip as it
# is now.
sub set_caps {
  my $q = shift;
  my $lid = ($q->{lid} // '') =~ /^\d+$/ ? $q->{lid} : return {error => 'no clip'};
  my $last = ($q->{last} // '') =~ /^\d+$/ ? $q->{last} : $lid;
  return {error => 'no such clip'} unless clip_view($lid, $last);
  my $now = time;
  if ($q->{reset}) {
    sql(sprintf "INSERT OR REPLACE INTO caps(lid, last, data, at) VALUES(%d, %d, NULL, %d);", $lid, $last, $now);
  } else {
    my $d = clean_caps(eval { JSON::PP->new->utf8->decode($q->{data} // '') }) or return {error => 'those lines can’t be saved'};
    sql(join "\n", 'BEGIN;',
      sprintf("INSERT OR REPLACE INTO caps(lid, last, data, at) VALUES(%d, %d, %s, %d);", $lid, $last, sql_quote(JSON::PP->new->canonical->encode($d)), $now),
      sprintf("UPDATE times SET s=-1, e=-1, at=%d WHERE lid=%d AND s >= 0;", $now, $lid), 'COMMIT;');
  }
  {ok => JSON::PP::true, clip => player_clip(clip_view($lid, $last))};
}

# The ♥ Liked list (stored as marks of kind keep), newest first: each with its line, the lines around and its ready
# clip entry (with his own times where he moved them).
sub kept {
  my @m = sql("SELECT lid, last, ifnull(query,''), at FROM marks WHERE kind='keep' ORDER BY at DESC;");
  my @v = clip_views(map { [$_->[0], $_->[1]] } @m);
  my @out;
  for my $n (0 .. $#m) {
    my ($lid, $last, $query, $at) = @{$m[$n]};
    my $c = $v[$n] or next;
    push @out, {lid => 0 + $lid, last => 0 + $c->{last}, query => $query, at => 0 + $at, id => $c->{v}, title => $c->{title},
      channel => $c->{channel}, kind => $c->{kind}, line => $c->{line}, s => $c->{s}, e => $c->{e},
      timed => $c->{timed} ? JSON::PP::true : JSON::PP::false, edited => $c->{edited} ? JSON::PP::true : JSON::PP::false,
      lines => [map { {s => $c->{screens}[$_]{s}, e => $c->{screens}[$_]{e}, text => $c->{screens}[$_]{t}, hit => $_ == $c->{clip} ? JSON::PP::true : JSON::PP::false} } 0 .. $#{$c->{screens}}],
      clip => player_clip($c)};
  }
  {kept => \@out};
}
sub json { my ($c, $d) = @_; reply($c, 200, 'application/json; charset=utf-8', JSON::PP->new->utf8->canonical->encode($d)) }

# The clip library's own player (docs/real-video: index.html + app.js, the one he likes: it stops at the line's end,
# "With context", the caption bar, the phrase's part of the timeline in yellow) plays a search result here:
# /player/?words=c-<line id>-<last line id>-q-<query words>&embed. Its "word" is made from the index on the fly and
# never saved; there is no edit.js here, so nothing can be edited or committed from this page.
# collect.pl --install copies the player next to this script (player/); run from the repo, it uses docs/real-video.
# The player's two files come from the live clip library (GitHub Pages), so it is always the one he uses there; they
# are kept for 6 hours, and the installed copy is used when there is no internet.
sub player_file {
  my $f = shift;
  my $cache = "$DIR/player/$f";
  if (!-e $cache || -M $cache > 0.25) {
    mkdir "$DIR/player";
    # Why a fetch failed goes to player/fetch.log (the page then uses the installed copy).
    open my $keep, '>&', \*STDERR; open STDERR, '>>', "$DIR/player/fetch.log";
    my $curl = first { -x $_ } map({ "$_/curl.exe" } split /;/, $ENV{PATH} // ''), 'C:/Windows/System32/curl.exe', '/mingw64/bin/curl', '/usr/bin/curl';
    system($curl // 'curl', '-sS', '-f', '--max-time', '8', '-o', "$cache.tmp", "$LIVE$f");
    my $rc = $?;
    open STDERR, '>&', $keep;
    if ($rc == 0 && (-s "$cache.tmp" // 0) > 1000) { rename "$cache.tmp", $cache } else { unlink "$cache.tmp" }
  }
  my $t = -s $cache ? slurp($cache) : '';
  length $t ? $t : slurp("$PLAYER/$f");
}
sub player {
  my ($c, $p) = @_;
  if ($p eq '/' || $p eq '/index.html') {
    my $h = player_file('index.html');
    return reply($c, 500, 'text/plain', "the clip player is missing ($PLAYER)") unless length $h;
    # Here (his wishes, Nov 21): no arrows beside the video and no speed buttons; Previous / Like / Next go in the row
    # with "With context" (the script added to app.js puts them there; the results page answers them).
    $h =~ s{</head>}{<style>/* site.pl */ .side,#speed,#cdots{display:none!important}
.tools .group{flex-wrap:nowrap!important}.ci-nav{display:inline-flex;gap:8px;align-items:center}.ci-prev,.ci-next{min-width:44px;justify-content:center;font-size:16px}.ci-like{white-space:nowrap}
.ci-nav .btn:disabled{opacity:.35;pointer-events:none}
.ci-like[aria-pressed="true"]{background:#e0245e!important;border-color:#e0245e!important;color:#fff!important}
</style></head>};
    utf8::encode($h);
    return reply($c, 200, 'text/html; charset=utf-8', $h);
  }
  if ($p eq '/app.js') {
    my $js = player_file('app.js');
    return reply($c, 500, 'text/plain', "the clip player is missing ($PLAYER)") unless length $js;
    # Added by site.pl: the results page drives the player (CI_App.playClip(), clipN, showClip()), and the player
    # always lays out as for one clip ("single": no arrows), so the video keeps the frame's whole width.
    $js .= <<'JS';

;window.CI_App = App;
// The caption editor's line times: a line outside the clip plays with "With context" on (the clip and its lines).
App.playAt = (at) => {
  const c = App.clip(); if (!c) return;
  if ((at < c.s - 0.05 || at > c.e) && typeof window.setMode === 'function') window.setMode(true);
  App.playClip(at);
};
(function () {
  const draw = window.drawCount;
  if (typeof draw !== 'function') return;
  window.drawCount = function (n, i) {
    draw(n, i);
    if (!document.body.classList.contains('single')) { document.body.classList.add('single'); if (typeof window.fitEmbed === 'function') window.fitEmbed(); }
  };
  document.body.classList.add('single');
})();
// Every time here is exact (from the captions, or set to the tenth on the page), but the player takes a start on a
// whole second (79.0) for YouGlish's rough times: it then plays 1.2 s past the end and lets it run past the next line
// (his bug, Nov 21: +0.1 s at the end added a whole second). So it always gets an exact start here.
(function () {
  const range = window.rangeOf;
  if (typeof range !== 'function') return;
  window.rangeOf = function (c, longer) {
    if (!c || !Number.isInteger(c.s)) return range(c, longer);
    const r = range(Object.assign({}, c, {s: c.s + 0.0001}), longer);
    r.c = c;
    return r;
  };
})();
// ◀ Previous, ♡ Like, Next ▶ in the row with "With context"; the results page (parent.CI) does the work and tells
// them what to show (CI_Buttons.set).
(function () {
  const row = document.querySelector('.tools .group'); if (!row) return;
  const ci = () => (window.parent !== window && window.parent.CI) || null;
  const mk = (cls, text, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + cls; b.textContent = text; b.title = title; b.onclick = () => { const c = ci(); if (c) c[fn](); }; return b; };
  const prev = mk('ci-prev', '◀', 'Previous clip', 'prev'), like = mk('ci-like', '♡ Like', 'Like this clip', 'like'), next = mk('ci-next', '▶', 'Next clip', 'next');
  const box = document.createElement('span'); box.className = 'ci-nav'; box.append(prev, like, next); row.appendChild(box);
  window.CI_Buttons = { set(o) { prev.disabled = !o.prev; next.disabled = !o.next; like.setAttribute('aria-pressed', o.liked ? 'true' : 'false'); like.textContent = o.liked ? '♥ Liked' : '♡ Like'; } };
})();
JS
    utf8::encode($js);
    return reply($c, 200, 'text/javascript; charset=utf-8', $js);
  }
  return reply($c, 200, 'application/json; charset=utf-8', '[]') if $p eq '/words/index.json';
  # c-<line>-<last line>… (one clip, or several: the results in a row), then -q-<the searched words>
  if ($p =~ m{^/words/c-((?:\d+-\d+)(?:-c-\d+-\d+)*)((?:-q-[a-z0-9-]+)?)\.json$}) {
    my @pairs = map { [split /-/] } split /-c-/, $1;
    return json($c, clip_word([@pairs[0 .. min($#pairs, 99)]], $2));
  }
  reply($c, 404, 'text/plain', 'not found');
}
# Search results as one library "word": a clip each, with its line (both lines when the phrase runs on), exact times,
# two lines before and after (for "With context"), and the searched words in yellow (hl).
sub clip_word {
  my ($pairs, $q) = @_;
  my @clips = map { player_clip($_) } grep { defined } clip_views(@$pairs);
  (my $words = $q // '') =~ s/^-q-//;
  my @alts = grep { length } map { join '[^a-z0-9]+', grep { length } split /-/ } split /-qq-/, $words;
  {en => (join(' ', split /-/, (split /-qq-/, $words)[0] // '') || 'clips'), ua => '', pic => '',
   (@alts ? (hl => '\b(?:' . join('|', @alts) . ')\b') : ()), clips => \@clips};
}

# A clip for the player (a clip in a library word file, plus what the page needs): his edited lines where he changed
# them, his times where he moved them; start0 / end0 = the clip line's own times (for ↺); screens = all its lines in
# order, screens[clip] = its own (the caption editor's).
sub player_clip {
  my $c = shift or return;
  {v => $c->{v}, s => $c->{s}, e => $c->{e}, line => $c->{line}, note => '', around => $c->{around}, lid => $c->{lid}, last => $c->{last},
   start0 => $c->{s0}, end0 => $c->{e0}, screens => $c->{screens}, star => $c->{clip},
   edited => $c->{edited} ? JSON::PP::true : JSON::PP::false, timed => $c->{timed} ? JSON::PP::true : JSON::PP::false};
}
# The caption editor (shared with the picks page online): the installed copy, else the repo's.
sub script {
  my $c = shift;
  my $js = slurp(-e "$BIN/caps.js" ? "$BIN/caps.js" : "$BIN/../../../docs/real-video/picks/caps.js");
  return reply($c, 404, 'text/plain', 'caps.js is missing') unless length $js;
  utf8::encode($js);
  reply($c, 200, 'text/javascript; charset=utf-8', $js);
}

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
  my $ip = lan_ip();
  # Tailscale (once he has it on this PC): its own address, for his phone anywhere.
  my $tsx = 'C:/Program Files/Tailscale/tailscale.exe';
  my $ts = -e $tsx ? (`"$tsx" ip -4 2>&1` =~ /^(100\.\d+\.\d+\.\d+)/m)[0] : undef;
  {videos => $n{done} // 0, phone => ($ip ? "http://$ip:$port" : undef), anywhere => ($ts ? "http://$ts:$port" : undef), pin => $PIN, human => $k{human} // 0, auto => $k{auto} // 0, lines => $lines, hours => $hours,
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
