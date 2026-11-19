#!/usr/bin/env perl
# Private caption index, the collector: fills ~/.cache/caption-index/index.db with the English captions of the
# channels in channels.json, so clips can be searched with search.pl instead of Caption Search's trial.
#
#   perl tools/real-video/index/collect.pl --status      how far it has got (add -v for every channel)
#   perl tools/real-video/index/collect.pl --stop        stop it (it stays stopped until --start)
#   perl tools/real-video/index/collect.pl --start       start it again, hidden, through the scheduled task
#   perl tools/real-video/index/collect.pl --install     copy these files to %LOCALAPPDATA%\Programs\caption-index\
#                                                        and (re)make the scheduled task that runs them
#   perl tools/real-video/index/collect.pl               run in this window (what the scheduled task runs)
#   perl tools/real-video/index/collect.pl --once <video id>   fetch one video now (a test)
#   options: --per-channel 400 (most-viewed videos taken from each channel), --pause 5-10 (seconds between videos)
#
# He chose this on Nov 19, knowing that automated caption download is against YouTube's terms: it is for his
# private use only. So the index never goes in this repo (public), a page, a commit or anything a student loads;
# only the few clip lines in docs/real-video/words/ are kept, as before.
#
# How it works: yt-dlp (logged out: no browser cookies, no Google account, its own config ignored) lists each
# channel's videos once (most-viewed first; re-listed every 30 days), then fetches one video's captions at a time,
# taking one video from each channel in turn, so the index is useful from the first hour. Uploaded (human) captions
# are kept when there are any, otherwise YouTube's auto-captions with each word's time. Lines are cut into
# sentences. About 130 videos an hour (~15 s in yt-dlp, with its own pauses, plus 5-10 s between videos, with
# jitter); YouTube rate-limits logged-out users at about 300 an hour. On HTTP 429, a "confirm you're not a bot" page or a rate-limit
# message it stops for 4 hours (8, 16, then 24 if it happens again within a day) and never retries sooner.
# yt-dlp updates itself (yt-dlp -U, from its GitHub releases) once a day, as YouTube keeps changing.
# Everything is resumable: a video is either in the index or still in the queue.
# Files: index.db, collector.log, state.json in ~/.cache/caption-index/ (C:\Users\<you>\.cache\caption-index).
use strict; use warnings; use utf8;
# This script's folder, also when started as C:...llect.pl (FindBin gets that wrong in Git Bash's Perl).
our $BIN; BEGIN { ($BIN = __FILE__) =~ tr{\\}{/}; $BIN =~ s{/[^/]*$}{} or $BIN = '.'; unshift @INC, $BIN }
use CaptionIndex;
use JSON::PP; use Fcntl qw(:flock); use Time::HiRes qw(sleep time); use File::Path qw(make_path remove_tree);
use File::Copy qw(copy); use POSIX qw(strftime WNOHANG _exit); use List::Util qw(shuffle min max sum0);
binmode STDOUT, ':encoding(UTF-8)'; binmode STDERR, ':encoding(UTF-8)';
$| = 1;

my %opt = (per => 400, pause => '5-10');
my @args;
while (@ARGV) {
  my $a = shift @ARGV;
  if ($a eq '--per-channel') { $opt{per} = shift @ARGV }
  elsif ($a eq '--pause') { $opt{pause} = shift @ARGV }
  elsif ($a =~ /^--(status|stop|start|install|once|list|help)$/) { $opt{$1} = 1 }
  elsif ($a eq '-v') { $opt{v} = 1 }
  else { push @args, $a }
}
die "usage: see the top of $0\n" if $opt{help};
my ($pmin, $pmax) = $opt{pause} =~ /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/ ? ($1, $2) : (5, 10);

my $DIR = data_dir();
my $LOG = "$DIR/collector.log";
my $TASK = 'Caption index collector';
my $CONFIG = "$BIN/channels.json";
$ENV{PYTHONIOENCODING} = 'utf-8'; $ENV{PYTHONUTF8} = '1';

# Signs that YouTube wants us to slow down: stop for hours, don't retry.
my $RATE = qr/HTTP Error 429|Too Many Requests|not a bot|rate.?limit|unusual traffic|content isn.t available|try again later/i;
# Videos that can't be had logged out: mark them and move on.
my $GONE = qr/Private video|Video unavailable|has been removed|no longer available|account associated with this video|members.only|Join this channel|confirm your age|age.restricted|inappropriate for some users|not available in your country|not made this video available|This live event|Premieres? in|copyright/i;

if ($opt{status}) { status(); exit }
if ($opt{stop}) {
  open my $h, '>', "$DIR/stop" or die "can't write $DIR/stop: $!\n"; close $h;
  print "The collector stops after the video it is on (within a minute or so) and stays stopped until --start.\n";
  exit;
}
if ($opt{start}) { unlink "$DIR/stop"; start_task(); exit }
if ($opt{install}) { install(); exit }
if ($opt{once}) { init_db(); sync_channels(); my $id = $args[0] or die "--once needs a video id\n"; once($id); exit }
if ($opt{list}) { init_db(); sync_channels(); my ($c) = grep { $_->{key} eq ($args[0] // '') } channels(); die "no channel $args[0]\n" unless $c; list_channel($c); exit }
run();
exit;

# ---------------------------------------------------------------------------------------------------------------

sub logl {
  my $msg = join '', @_;
  my $line = strftime('%m-%d %H:%M:%S', localtime) . "  $msg\n";
  if (-s $LOG && -s $LOG > 5_000_000) { rename $LOG, "$LOG.1" }
  if (open my $h, '>>:encoding(UTF-8)', $LOG) { print $h $line; close $h }
  print $line if -t STDOUT;
}

my @CHANNELS;
sub channels { @CHANNELS = load_channels($CONFIG) unless @CHANNELS; @CHANNELS }

sub sync_channels {
  my @s;
  for my $c (channels()) {
    push @s, sprintf("INSERT INTO channels(key, id, name, handle) VALUES(%s, %s, %s, %s) ON CONFLICT(key) DO UPDATE SET id=excluded.id, name=excluded.name, handle=excluded.handle;",
      map { sql_quote($_) } $c->{key}, $c->{id}, $c->{name}, $c->{handle} // '');
  }
  sql(join "\n", @s);
}

sub state_set { my %kv = @_; my $s = read_state(); @$s{keys %kv} = values %kv; write_state($s); $s }

sub stop_asked { -e "$DIR/stop" }

# Sleeps in short steps, so --stop works during a long pause.
sub nap {
  my $secs = shift;
  my $end = time + $secs;
  while (time < $end) {
    exit_if_stopped();
    sleep(min(30, $end - time));
  }
}
sub exit_if_stopped { if (stop_asked()) { logl('stopped (--stop)'); state_set(pid => undef, running => 0); exit 0 } }

sub wait_if_paused {
  my $s = read_state();
  my $until = $s->{paused_until} // 0;
  return if $until <= time;
  logl(sprintf 'paused until %s (%s)', strftime('%a %H:%M', localtime $until), $s->{pause_reason} // '');
  nap($until - time);
}

# YouTube pushed back: stop for 4 h, then 8, 16, 24 h if it keeps happening within a day.
sub strike {
  my $why = shift;
  $why =~ s/\s+/ /g; $why = substr($why, 0, 200);
  my $s = read_state();
  my $n = ($s->{last_strike} // 0) > time - 86400 ? ($s->{strikes} // 0) + 1 : 1;
  my $hours = (4, 8, 16, 24)[min($n, 4) - 1];
  state_set(strikes => $n, last_strike => int time, paused_until => int(time + $hours * 3600), pause_reason => $why);
  logl("YouTube pushed back ($why): stopping for $hours hours");
}

# Runs a program with its output in files, killing it after $timeout seconds.
sub run_cmd {
  my ($cmd, $timeout, $out, $err) = @_;
  my $pid = fork // die "fork: $!\n";
  if (!$pid) {
    open STDIN, '<', '/dev/null'; open STDOUT, '>', $out; open STDERR, '>', $err;
    exec @$cmd or _exit(127);
  }
  my $t0 = time;
  while (1) {
    my $r = waitpid($pid, WNOHANG);
    return $? >> 8 if $r == $pid;
    if (time - $t0 > $timeout) { kill 'KILL', $pid; waitpid $pid, 0; return -1 }
    sleep 0.3;
  }
}

sub ytdlp_base {
  (tool('yt-dlp'), '--ignore-config', '--no-cookies', '--no-cookies-from-browser', '--no-playlist',
   '--js-runtimes', 'deno:' . tool('deno'), '--extractor-args', 'youtube:skip=hls,dash,translated_subs',
   '--socket-timeout', '30', '--extractor-retries', '2', '--retry-sleep', 'extractor:20', '--no-progress');
}

sub update_ytdlp {
  my $s = read_state();
  return if ($s->{ytdlp_checked} // 0) > time - 86400;
  my $tmp = "$DIR/tmp"; make_path($tmp);
  my $rc = run_cmd([tool('yt-dlp'), '--ignore-config', '-U'], 300, "$tmp/update.out", "$tmp/update.err");
  my $msg = slurp("$tmp/update.out") . slurp("$tmp/update.err");
  my ($line) = reverse grep { /\S/ } split /\n/, $msg;
  logl('yt-dlp -U: ' . ($line // "exit $rc"));
  state_set(ytdlp_checked => int time);
}

# ---- listing a channel ----------------------------------------------------------------------------------------

sub list_channel {
  my $c = shift;
  my @urls = $c->{search}
    ? map { (my $q = $_) =~ s/ /+/g; "https://www.youtube.com/channel/$c->{id}/search?query=$q" } @{$c->{search}}
    : ("https://www.youtube.com/channel/$c->{id}/videos");
  my $tmp = "$DIR/tmp"; make_path($tmp);
  my %seen; my @e; my $failed;
  for my $url (@urls) {
    logl("listing $c->{name}: $url");
    my $rc = run_cmd([ytdlp_base(), '--flat-playlist', '--yes-playlist', '--sleep-requests', '2', '-I', '1:3000',
      '--print', 'E %(.{id,title,view_count,duration,live_status,availability})j', $url], 3600, "$tmp/list.out", "$tmp/list.err");
    my $err = slurp("$tmp/list.err");
    if ($err =~ $RATE) { strike((grep { $_ =~ $RATE } split /\n/, $err)[0]); return }
    for (split /\n/, slurp("$tmp/list.out")) {
      next unless s/^E //;
      my $x = eval { JSON::PP->new->decode($_) } or next;
      next if !$x->{id} || $seen{$x->{id}}++;
      push @e, $x;
    }
    if ($rc && !@e) { $failed = (grep { /ERROR/ } split /\n/, $err)[0] // "exit $rc" }
  }
  if ($failed) {   # try again in a day
    logl("listing $c->{name} failed: $failed");
    sql(sprintf "UPDATE channels SET listed_at=%d, note=%s WHERE key=%s;", time - 29 * 86400, sql_quote($failed), sql_quote($c->{key}));
    return;
  }
  my $re = $c->{titles} ? qr/$c->{titles}/ : undef;
  my @s = ('BEGIN;');
  my ($keep, $skip) = (0, 0);
  for my $x (@e) {
    my $d = $x->{duration};
    my $ok = (!defined $d || ($d >= 60 && $d <= 3 * 3600))
      && ($x->{live_status} // '') !~ /^(is_live|is_upcoming)$/
      && (!$re || ($x->{title} // '') =~ $re);
    $ok ? $keep++ : $skip++;
    push @s, sprintf("INSERT INTO videos(id, channel, title, dur, views, status) VALUES(%s, %s, %s, %s, %d, %s) ON CONFLICT(id) DO UPDATE SET views=excluded.views, title=excluded.title WHERE videos.channel=excluded.channel;",
      sql_quote($x->{id}), sql_quote($c->{key}), sql_quote($x->{title}), defined $d ? int $d : 'NULL', int($x->{view_count} // 0), sql_quote($ok ? 'later' : 'skip'));
  }
  push @s, sprintf("UPDATE channels SET listed_at=%d, listed=%d, note=NULL WHERE key=%s;", time, scalar @e, sql_quote($c->{key})), 'COMMIT;';
  sql(join "\n", @s);
  my $added = promote($c->{key});
  logl("listed $c->{name}: " . @e . " videos ($skip too short, long, live or off-topic); $added queued");
}

# Queues the most-viewed videos of a channel, up to --per-channel.
sub promote {
  my $key = shift;
  my ($n) = map { $_->[0] } sql(sprintf "SELECT count(*) FROM videos WHERE channel=%s AND status NOT IN ('later','skip');", sql_quote($key));
  my $room = $opt{per} - ($n // 0);
  return 0 if $room <= 0;
  sql(sprintf "UPDATE videos SET status='todo' WHERE k IN (SELECT k FROM videos WHERE channel=%s AND status='later' ORDER BY views DESC LIMIT %d);", sql_quote($key), $room);
  my ($m) = map { $_->[0] } sql(sprintf "SELECT count(*) FROM videos WHERE channel=%s AND status='todo';", sql_quote($key));
  $m // 0;
}

# ---- one video ------------------------------------------------------------------------------------------------

# Auto-captions: one event per screen line, a time for each word ("tOffsetMs"). We cut them into sentences.
sub auto_lines {
  my $d = shift;
  my (@w, $spk);
  for my $ev (@{$d->{events} || []}) {
    next if $ev->{aAppend} || ref $ev->{segs} ne 'ARRAY';
    my $t0 = $ev->{tStartMs} // 0;
    my @segs = @{$ev->{segs}};
    for my $i (0 .. $#segs) {
      my $sg = $segs[$i];
      my $txt = $sg->{utf8} // '';
      $spk = 1 if $sg->{isSpeakerChange};
      next unless $txt =~ /\S/;
      my $ms = $t0 + ($sg->{tOffsetMs} // 0);
      my $next = $i < $#segs ? $t0 + ($segs[$i + 1]{tOffsetMs} // 0) : $ms + 400;
      $next = $ms + 150 if $next <= $ms;
      my @ws;
      for (split ' ', $txt) {
        if (/^>>+$/) { $spk = 1; next }
        s/^>>+//; s/[\x{200B}-\x{200D}\x{FEFF}]//g;
        push @ws, $_ if length;
      }
      for my $j (0 .. $#ws) {
        push @w, [$ws[$j], $ms + int(($next - $ms) * $j / @ws), $spk ? 1 : 0];
        $spk = 0;
      }
    }
  }
  return [] unless @w;
  # Newer auto-captions have capitals and full stops; older ones don't, so they are cut at pauses instead.
  my $stops = grep { $_->[0] =~ /[.?!]["')\]]*$/ } @w;
  my $punct = $stops >= @w / 60;
  my (@lines, @cur);
  for my $x (@w) {
    if (@cur) {
      my $prev = $cur[-1][0];
      my $gap = $x->[1] - $cur[-1][1];
      my $n = @cur;
      my $end = $prev =~ /[.?!…]["')\]]*$/ && $prev !~ /^(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs)\.$/i;
      my $cut = $x->[2] || $gap > 2500
        || ($punct ? ($end || ($n >= 25 && $prev =~ /[,;:]$/) || $n >= 35) : (($gap > 700 && $n >= 4) || $n >= 14));
      if ($cut) { push @lines, [@cur]; @cur = () }
    }
    push @cur, $x;
  }
  push @lines, [@cur] if @cur;
  my @out;
  for my $i (0 .. $#lines) {
    my $l = $lines[$i];
    my ($s, $last) = ($l->[0][1], $l->[-1][1]);
    my $e = $last + 800;
    $e = min($e, $lines[$i + 1][0][1]) if $i < $#lines;
    $e = $last + 100 if $e <= $last;
    push @out, {s => $s, e => $e, text => join(' ', map { $_->[0] } @$l), w => join(' ', map { $_->[1] - $s } @$l)};
  }
  \@out;
}

# Uploaded captions: one event per caption, exact start and end. Captions that go on mid-sentence are joined.
# Some channels (MrBeast) upload karaoke-style captions: a time for each word, and every caption twice (two
# styles drawn on top of each other). The copies are dropped and the word times kept, as for auto-captions.
sub human_lines {
  my $d = shift;
  my (@ev, %seen);
  for my $ev (@{$d->{events} || []}) {
    next if ref $ev->{segs} ne 'ARRAY';
    my $s = $ev->{tStartMs} // 0;
    my ($text, @t, $timed) = ('');
    for my $sg (@{$ev->{segs}}) {
      my $u = $sg->{utf8} // '';
      $u =~ s/[\x{200B}-\x{200D}\x{FEFF}]//g;
      $timed = 1 if $sg->{tOffsetMs};
      push @t, ($s + ($sg->{tOffsetMs} // 0)) x length $u;
      $text .= $u;
    }
    my @w;
    while ($text =~ /(\S+)/g) { push @w, [$1, $t[$-[1]]] }
    next unless @w;
    if (@w % 2 == 0) {   # the same caption twice in one event
      my $h = @w / 2;
      splice @w, $h if join(' ', map { $_->[0] } @w[0 .. $h - 1]) eq join(' ', map { $_->[0] } @w[$h .. $#w]);
    }
    my $line = join ' ', map { $_->[0] } @w;
    next if $seen{"$s|$line"}++;
    push @ev, {s => $s, e => $s + ($ev->{dDurationMs} // 0), text => $line, t => ($timed ? [map { $_->[1] } @w] : undef)};
  }
  @ev = sort { $a->{s} <=> $b->{s} } @ev;
  my @out;
  my $words = sub { scalar(() = $_[0] =~ /\S+/g) };
  for my $x (@ev) {
    my $p = $out[-1];
    if ($p && $p->{text} !~ /[.?!…♪\])"”:;]$/ && $x->{s} - $p->{e} < 600 && $x->{s} - $p->{s} < 12000
        && $x->{text} !~ /^(?:-|>>|\[|\(|♪|[A-Z][A-Z .']+:)/ && $words->($p->{text}) + $words->($x->{text}) <= 25) {
      $p->{text} .= " $x->{text}"; $p->{e} = max($p->{e}, $x->{e});
      $p->{t} = $p->{t} && $x->{t} ? [@{$p->{t}}, @{$x->{t}}] : undef;
      next;
    }
    push @out, {%$x};
  }
  for my $i (0 .. $#out) {
    my $l = $out[$i];
    $l->{e} = $out[$i + 1]{s} if $i < $#out && $out[$i + 1]{s} > $l->{s} && $l->{e} > $out[$i + 1]{s};
    my $t = delete $l->{t};
    $l->{w} = join ' ', map { max(0, $_ - $l->{s}) } @$t if $t;
  }
  \@out;
}

# Column assignments for UPDATE videos: numbers as numbers, the rest as text.
my %NUM = map { $_ => 1 } qw(dur views embed lines tries fetched_at alive checked_at);
sub assign {
  my %f = @_;
  join ', ', map { "$_=" . ($NUM{$_} ? (defined $f{$_} && $f{$_} ne '' ? int $f{$_} : 'NULL') : sql_quote($f{$_})) } sort keys %f;
}
sub set_video { my ($k, %f) = @_; sql(sprintf "UPDATE videos SET %s WHERE k=%d;", assign(%f), $k) }

sub store_lines {
  my ($v, $lines, %f) = @_;
  my $k = $v->{k};
  my $base = $k * 100000;
  my @L = @$lines[0 .. min($#$lines, 99_998)];
  my @s = ('BEGIN;');
  push @s, "DELETE FROM win WHERE rowid BETWEEN $base AND " . ($base + 99_999) . ";",
           "DELETE FROM lines WHERE id BETWEEN $base AND " . ($base + 99_999) . ";" if $v->{lines};
  for (my $i = 0; $i < @L; $i += 200) {
    my $j = min($i + 199, $#L);
    push @s, 'INSERT INTO lines(id, s, e, text, w) VALUES ' . join(",\n", map {
      sprintf "(%d, %d, %d, %s, %s)", $base + $_, $L[$_]{s}, $L[$_]{e}, sql_quote($L[$_]{text}), defined $L[$_]{w} ? sql_quote($L[$_]{w}) : 'NULL'
    } $i .. $j) . ';';
    push @s, 'INSERT INTO win(rowid, text) VALUES ' . join(",\n", map {
      sprintf "(%d, %s)", $base + $_, sql_quote($L[$_]{text} . ($_ < $#L ? " $L[$_ + 1]{text}" : ''))
    } $i .. $j) . ';';
  }
  my %set = (%f, status => 'done', lines => scalar @L, fetched_at => int time, note => undef);
  push @s, sprintf("UPDATE videos SET %s WHERE k=%d;", assign(%set), $k), 'COMMIT;';
  sql(join "\n", @s);
}

# Returns 'done', 'none' (no English captions), 'gone', 'error' or 'rate' (YouTube pushed back).
sub fetch_video {
  my $v = shift;
  my $id = $v->{id};
  my $tmp = "$DIR/tmp/v"; remove_tree($tmp); make_path($tmp);
  my $rc = run_cmd([ytdlp_base(), '--skip-download', '--no-simulate', '--write-subs', '--write-auto-subs',
    '--sub-langs', 'en,en-US,en-GB,en-CA,en-AU', '--sub-format', 'json3', '--sleep-requests', '0.75', '--sleep-subtitles', '2',
    '-o', "subtitle:$tmp/%(id)s", '-o', "$tmp/%(id)s",
    '--print', 'INFO %(.{id,title,channel,channel_id,duration,upload_date,view_count,playable_in_embed,availability,language,live_status})j',
    '--print', 'SUBS %(subtitles)j', "https://www.youtube.com/watch?v=$id"], 300, "$tmp/out.txt", "$tmp/err.txt");
  my $out = slurp("$tmp/out.txt");
  my $err = join "\n", grep { !/ffmpeg not found|Incomplete data received|re-fetching using API/ } split /\n/, slurp("$tmp/err.txt");
  my ($first) = ((grep { /ERROR/ } split /\n/, $err), (grep { /\S/ } split /\n/, $err));
  if ($err =~ $RATE) {
    strike((grep { $_ =~ $RATE } split /\n/, $err)[0]);
    set_video($v->{k}, tries => $v->{tries} + 1, note => 'pushed back on this one');
    if ($v->{tries} + 1 >= 3) { set_video($v->{k}, status => 'gone', note => 'pushed back 3 times on this one') }
    return 'rate';
  }
  my ($info) = $out =~ /^INFO (.*)$/m;
  my $i = $info ? eval { JSON::PP->new->decode($info) } : undef;
  if (!$i) {
    if ($err =~ $GONE) { set_video($v->{k}, status => 'gone', note => substr($first // 'unavailable', 0, 200)); return 'gone' }
    my $t = $v->{tries} + 1;
    set_video($v->{k}, tries => $t, note => substr($first // "yt-dlp exit $rc", 0, 200), ($t >= 3 ? (status => 'error') : ()));
    return 'error';
  }
  my %f = (title => $i->{title}, dur => int($i->{duration} // 0), views => int($i->{view_count} || $v->{views} || 0),
    uploaded => $i->{upload_date}, lang => $i->{language},
    embed => (ref $i->{playable_in_embed} ? ($i->{playable_in_embed} ? 1 : 0) : undef));
  my ($subs) = $out =~ /^SUBS (.*)$/m;
  my $manual = $subs && $subs ne 'NA' ? (eval { JSON::PP->new->decode($subs) } || {}) : {};
  opendir(my $dh, $tmp); my %file = map { /^\Q$id\E\.(.+)\.json3$/ ? ($1 => "$tmp/$_") : () } readdir $dh; closedir $dh;
  my ($lang, $kind);
  for my $l ('en', 'en-US', 'en-CA', 'en-GB', 'en-AU') { if ($manual->{$l} && $file{$l}) { ($lang, $kind) = ($l, 'human'); last } }
  if (!$lang && $file{en} && !$manual->{en} && ($i->{language} // 'en') =~ /^en/) { ($lang, $kind) = ('en', 'auto') }
  if (!$lang) {
    set_video($v->{k}, %f, status => 'none', fetched_at => int time,
      note => ($i->{language} && $i->{language} !~ /^en/ ? "spoken language: $i->{language}" : 'no English captions'));
    return 'none';
  }
  my $d = eval { JSON::PP->new->decode(slurp($file{$lang})) };
  my $lines = $d ? ($kind eq 'auto' ? auto_lines($d) : human_lines($d)) : [];
  if (!@$lines) { set_video($v->{k}, %f, status => 'none', fetched_at => int time, note => 'empty captions'); return 'none' }
  store_lines($v, $lines, %f, kind => $kind);
  logl(sprintf '%s · %s · %s · %d lines · %s', $v->{channel}, $id, $kind, scalar @$lines, $i->{title} // '');
  'done';
}

sub once {
  my $id = shift;
  my ($r) = sql(sprintf "SELECT k, id, channel, tries, ifnull(lines,0), views FROM videos WHERE id=%s;", sql_quote($id));
  if (!$r) {
    sql(sprintf "INSERT INTO videos(id, channel, status) VALUES(%s, 'other', 'todo');", sql_quote($id));
    ($r) = sql(sprintf "SELECT k, id, channel, tries, ifnull(lines,0), views FROM videos WHERE id=%s;", sql_quote($id));
  }
  my %v; @v{qw(k id channel tries lines views)} = @$r;
  print "$id: ", fetch_video(\%v), "\n";
}

# ---- the main loop --------------------------------------------------------------------------------------------

sub run {
  make_path($DIR);
  open my $lock, '>>', "$DIR/collector.lock" or die "can't open the lock file: $!\n";
  if (!flock($lock, LOCK_EX | LOCK_NB)) { print "The collector is already running.\n"; exit 0 }
  if (stop_asked()) { print "The collector was stopped with --stop; start it again with --start.\n"; exit 0 }
  $SIG{__DIE__} = sub { logl("stopped by an error: $_[0]") unless $^S };
  init_db(); sync_channels();
  promote($_->{key}) for channels();
  state_set(pid => $$, running => 1, started => int time);
  logl("started (pid $$, " . scalar(channels()) . " channels, up to $opt{per} videos each)");
  my %known = map { $_->{key} => 1 } channels();
  my %run = (since_list => 1e9, errors => 0);
  while (1) {
    eval { round(\%known, \%run); 1 } or do {   # e.g. the database was busy too long: log it, wait, go on
      my $e = $@ || 'unknown error'; chomp $e;
      logl("error: $e");
      nap(120);
    };
  }
}

# One round: list a channel that needs it, or fetch one video from each channel.
sub round {
  my ($known, $run) = @_;
  exit_if_stopped();
  wait_if_paused();
  update_ytdlp();
  my $old = time - 30 * 86400;
  my @unlisted = grep { $known->{$_} } map { $_->[0] } sql("SELECT key FROM channels WHERE listed_at IS NULL OR listed_at < $old ORDER BY listed_at IS NOT NULL, listed_at, rowid;");
  my @batch = map { my %v; @v{qw(k id channel tries lines views)} = @$_; \%v }
    grep { $known->{$_->[2]} } sql("SELECT k, id, channel, tries, ifnull(lines,0), views FROM (SELECT *, row_number() OVER (PARTITION BY channel ORDER BY views DESC, k) r FROM videos WHERE status='todo') WHERE r=1;");
  if (@unlisted && ($run->{since_list} >= 12 || !@batch)) {   # a new channel after every 12 videos
    my ($c) = grep { $_->{key} eq $unlisted[0] } channels();
    list_channel($c);
    $run->{since_list} = 0;
    nap($pmin + rand($pmax - $pmin));
    return;
  }
  if (!@batch) { logl('nothing left to fetch; looking again in 6 hours'); nap(6 * 3600); return }
  for my $v (shuffle @batch) {
    exit_if_stopped();
    wait_if_paused();
    my $r = fetch_video($v);
    $run->{since_list}++;
    return if $r eq 'rate';
    if ($r eq 'error') {
      logl("$v->{channel} · $v->{id} · failed (try " . ($v->{tries} + 1) . " of 3)");
      if (++$run->{errors} >= 8) {   # many failures in a row: yt-dlp may be out of date
        logl('8 failures in a row: updating yt-dlp and waiting an hour');
        state_set(ytdlp_checked => 0); update_ytdlp(); $run->{errors} = 0; nap(3600);
        return;
      }
    } else { $run->{errors} = 0 }
    state_set(last_video => "$v->{channel} · $v->{id}", last_video_at => int time);
    nap($pmin + rand($pmax - $pmin));
    return if @unlisted && $run->{since_list} >= 12;
  }
}

# ---- status, install ------------------------------------------------------------------------------------------

sub running {
  open my $lock, '>>', "$DIR/collector.lock" or return 0;
  my $free = flock($lock, LOCK_EX | LOCK_NB);
  flock($lock, LOCK_UN) if $free;
  !$free;
}

sub commas { my $n = reverse int(shift // 0); $n =~ s/(\d{3})(?=\d)/$1,/g; scalar reverse $n }

sub status {
  my $db = db_path();
  if (!-e $db) { print "No index yet ($db). Start the collector: perl tools/real-video/index/collect.pl --start\n"; return }
  my $s = read_state();
  my $mb = sum0(map { -s $_ // 0 } $db, "$db-wal") / 1e6;
  printf "Caption index (private, this PC only): %s, %s MB\n", $db, $mb < 10 ? sprintf('%.1f', $mb) : sprintf('%.0f', $mb);
  my $when = sub { my $t = shift; $t ? strftime('%a %b %e %H:%M', localtime $t) : '?' };
  my $state = running() ? 'running' : stop_asked() ? 'stopped (--stop; --start starts it again)' : 'not running';
  $state .= sprintf ', paused until %s (%s)', $when->($s->{paused_until}), $s->{pause_reason} // '' if ($s->{paused_until} // 0) > time;
  $state .= sprintf '; last video %s (%s)', $when->($s->{last_video_at}), $s->{last_video} // '' if $s->{last_video_at};
  print "Collector: $state\n";
  my %n = map { $_->[0] => $_->[1] } sql("SELECT status, count(*) FROM videos GROUP BY status;");
  my %k = map { $_->[0] => $_->[1] } sql("SELECT kind, count(*) FROM videos WHERE status='done' GROUP BY kind;");
  my ($lines) = map { $_->[0] } sql("SELECT ifnull(sum(lines),0) FROM videos WHERE status='done';");
  printf "Searchable: %s videos (%s with human captions, %s auto), %s lines\n", commas($n{done}), commas($k{human}), commas($k{auto}), commas($lines);
  printf "Left out: %s without English captions, %s unavailable, %s failed 3 times\n", commas($n{none}), commas($n{gone}), commas($n{error});
  my ($listed, $all) = map { @$_ } sql("SELECT count(listed_at), count(*) FROM channels;");
  my ($last_hour) = map { $_->[0] } sql(sprintf "SELECT count(*) FROM videos WHERE fetched_at > %d;", time - 3600);
  printf "Queue: %s to fetch (the %d most-viewed of each channel); %d of %d channels listed; %s fetched in the last hour\n",
    commas($n{todo}), $opt{per}, $listed, $all, commas($last_hour);
  return unless $opt{v};
  print "\n";
  for (sql("SELECT c.name, c.listed, sum(v.status='done'), sum(v.kind='human' AND v.status='done'), sum(v.status='todo'), c.note FROM channels c LEFT JOIN videos v ON v.channel=c.key GROUP BY c.key ORDER BY c.rowid;")) {
    my ($name, $listed, $done, $human, $todo, $note) = @$_;
    printf "  %-40s %6s listed  %5s done (%s human)  %5s to fetch%s\n", $name, $listed eq '' ? '-' : $listed, $done || 0, $human || 0, $todo || 0, $note ? "  ($note)" : '';
  }
}

sub start_task {
  local $ENV{MSYS_NO_PATHCONV} = 1; local $ENV{MSYS2_ARG_CONV_EXCL} = '*';   # Git Bash would turn /run into a path
  my $out = `schtasks /run /tn "$TASK" 2>&1`;
  if ($? == 0) { print "Started (hidden). See how it goes with: perl tools/real-video/index/collect.pl --status\n" }
  else { print "No scheduled task yet ($out). Make it with --install, or run this script without options to collect in this window.\n" }
}

# Copies the collector out of the repo (worktrees come and go) and makes the scheduled task: at logon and every hour
# (it starts only when not already running), hidden, below-normal priority, no time limit.
sub install {
  my $to = win_path($ENV{LOCALAPPDATA} // die "no LOCALAPPDATA\n") . '/Programs/caption-index';
  make_path($to);
  for my $f (qw(collect.pl search.pl CaptionIndex.pm channels.json)) {
    copy("$BIN/$f", "$to/$f") or die "can't copy $f to $to: $!\n";
  }
  print "Copied the collector to $to\n";
  my $perl = -x '/usr/bin/perl.exe' ? `cygpath -w /usr/bin/perl.exe` : $^X;   # Git for Windows' Perl
  chomp $perl;
  die "can't find perl.exe (got $perl)\n" unless $perl =~ /^[A-Za-z]:\\.*perl\.exe$/i;
  (my $script = "$to/collect.pl") =~ s{/}{\\}g;
  # Perl is a console program: wscript starts it with no window at all (0) and waits for it (True), so the task
  # shows as running while it collects. (conhost --headless doesn't start anything from the Task Scheduler.)
  (my $vbs = "$to/run-hidden.vbs") =~ s{/}{\\}g;
  open my $v, '>', "$to/run-hidden.vbs" or die "can't write $to/run-hidden.vbs: $!\n";
  print $v qq{' Starts the caption index collector with no window (made by collect.pl --install)\r\n},
    qq{CreateObject("WScript.Shell").Run """$perl"" ""$script""", 0, True\r\n};
  close $v;
  my $ps = <<"PS";
\$ErrorActionPreference = 'Stop'; \$ProgressPreference = 'SilentlyContinue'
\$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '//B //Nologo "$vbs"'
\$me = "\$env:USERDOMAIN\\\$env:USERNAME"
\$t1 = New-ScheduledTaskTrigger -AtLogOn -User \$me
\$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 1)
\$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -Priority 7
\$p = New-ScheduledTaskPrincipal -UserId \$me -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName '$TASK' -Action \$a -Trigger \$t1,\$t2 -Settings \$s -Principal \$p -Force -Description 'Private caption index (craneberries tools/real-video/index): fetches YouTube captions slowly, logged out. Stop: perl collect.pl --stop' | Out-Null
PS
  require Encode; require MIME::Base64;
  my $b64 = MIME::Base64::encode_base64(Encode::encode('UTF-16LE', $ps), '');
  system('powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', $b64);
  die "Making the scheduled task failed.\n" if $?;
  print "Scheduled task \"$TASK\" made (at logon and every hour, hidden).\n";
}
