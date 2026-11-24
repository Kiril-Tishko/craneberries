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
#   perl tools/real-video/index/collect.pl --drop <video id>   take a video out of the index (not a scene, not a song)
#   options: --per-channel 400 (most-viewed videos taken from each channel), --gap 40 (seconds per video, at least),
#            --round 120 --rest 4 (a rest of 4 hours after every 120 caption files)
#
# He chose this on Nov 19, knowing that automated caption download is against YouTube's terms: it is for his
# private use only. So the index never goes in this repo (public), a page, a commit or anything a student loads;
# only the few clip lines in docs/real-video/words/ are kept, as before.
#
# How it works: yt-dlp (logged out: no browser cookies, no Google account, its own config ignored) lists each
# channel's videos once (most-viewed first; re-listed every 30 days), then fetches one video's captions at a time,
# taking one video from each channel in turn (each channel's longest first), so the index is useful from the first
# hour. Uploaded (human) captions are kept when there are any, otherwise YouTube's auto-captions with each word's
# time. Lines are cut into sentences. A video costs YouTube 4 requests (the watch page, two player requests, one
# caption file; see fetch_video) and takes 6-8 s; a new one starts every 30-50 s (--gap 40, with jitter), and after
# every 120 caption files it rests 4 hours (--round 120, --rest 4; see count_caption): about 500 videos a day. On
# HTTP 429, a "confirm you're not a bot" page or a rate-limit message it stops for 4 hours (8, 16, then 24 if it
# happens again within a day), never retries sooner, and then goes on half as slowly again (back down a day later).
# yt-dlp updates itself (yt-dlp -U, from its GitHub releases) once a day, as YouTube keeps changing.
# Everything is resumable: a video is either in the index or still in the queue.
# Files: index.db, collector.log, state.json in ~/.cache/caption-index/ (C:\Users\<you>\.cache\caption-index).
use strict; use warnings; use utf8;
# This script's folder, also when started as C:...llect.pl (FindBin gets that wrong in Git Bash's Perl).
our $BIN; BEGIN { ($BIN = __FILE__) =~ tr{\\}{/}; $BIN =~ s{/[^/]*$}{} or $BIN = '.'; unshift @INC, $BIN }
use CaptionIndex;
use JSON::PP; use Fcntl qw(:flock); use Time::HiRes qw(sleep time); use File::Path qw(make_path remove_tree);
use File::Copy qw(copy); use POSIX qw(strftime WNOHANG _exit); use List::Util qw(shuffle min max sum0 first);
binmode STDOUT, ':encoding(UTF-8)'; binmode STDERR, ':encoding(UTF-8)';
$| = 1;

my %opt = (per => 400, gap => 40, round => 120, rest => 4);
my @args;
while (@ARGV) {
  my $a = shift @ARGV;
  if ($a =~ /^--(per-channel|gap|round|rest)$/) { $opt{$1 eq 'per-channel' ? 'per' : $1} = shift @ARGV }
  elsif ($a =~ /^--(status|stop|start|install|once|list|drop|help)$/) { $opt{$1} = 1 }
  elsif ($a eq '-v') { $opt{v} = 1 }
  else { push @args, $a }
}
die "usage: see the top of $0\n" if $opt{help};
$opt{gap} = 40 unless $opt{gap} =~ /^\d+(?:\.\d+)?$/ && $opt{gap} >= 10;
$opt{round} = 120 unless $opt{round} =~ /^\d+$/ && $opt{round} >= 10;
$opt{rest} = 4 unless $opt{rest} =~ /^\d+(?:\.\d+)?$/ && $opt{rest} >= 1;
$opt{per} = 400 unless $opt{per} =~ /^\d+$/;

my $DIR = data_dir();
my $LOG = "$DIR/collector.log";
my $TASK = 'Caption index collector';
my $SITE_TASK = 'Caption index page';   # site.pl: the index as a page on this PC (http://localhost:8770)
my $SYNC_TASK = 'Caption index sync';   # sync.pl: his picks, both ways with docs/real-video/picks/picks.json
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
if ($opt{drop}) { init_db(); my $id = $args[0] or die "--drop needs a video id\n"; drop($id); exit }
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
  # "show" came on Nov 21 (a show's clips can be searched on their own: search.pl --show breaking-bad).
  push @s, 'ALTER TABLE channels ADD COLUMN show TEXT;' unless grep { $_->[1] eq 'show' } sql('PRAGMA table_info(channels);');
  for my $c (channels()) {
    push @s, sprintf("INSERT INTO channels(key, id, name, handle, show) VALUES(%s, %s, %s, %s, %s) ON CONFLICT(key) DO UPDATE SET id=excluded.id, name=excluded.name, handle=excluded.handle, show=excluded.show;",
      map { sql_quote($_) } $c->{key}, $c->{id}, $c->{name}, $c->{handle} // '', $c->{show});
  }
  sql(join "\n", @s);
}
# Channels marked "first" (a show a student loves) are listed and fetched before all the others.
sub first_keys { map { $_->{key} } grep { $_->{first} } channels() }

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
  my $gap = min(120, max($opt{gap}, $s->{gap} // $opt{gap}) * 1.5);
  my $size = max(40, int(min($opt{round}, $s->{round_size} // $opt{round}) * 0.75));
  state_set(strikes => $n, last_strike => int time, paused_until => int(time + $hours * 3600), pause_reason => $why,
    gap => $gap, gap_eased => int time, round_n => 0, round_size => $size, round_grown => int time);
  logl("YouTube pushed back ($why): stopping for $hours hours, then one video every " . int($gap) . " s, resting after $size");
}

# Planned rests. On Nov 19 YouTube's caption server said 429 after about 160 caption files twice, once fast and once
# at half the pace, so the count matters more than the pace: after every --round caption files (120) the collector
# rests --rest hours (4), before YouTube complains. After a pushback the rounds get a quarter smaller (at least 40);
# they grow back by 10 after each day without one.
sub round_size {
  my $s = read_state();
  my $r = min($opt{round}, $s->{round_size} // $opt{round});
  if ($r < $opt{round} && time - ($s->{last_strike} // 0) > 86400 && time - ($s->{round_grown} // 0) > 86400) {
    $r = min($opt{round}, $r + 10);
    state_set(round_size => $r, round_grown => int time);
  }
  $r;
}
sub count_caption {   # after each caption file asked for (step 2 of fetch_video)
  my $n = (read_state()->{round_n} // 0) + 1;
  my $size = round_size();
  if ($n < $size) { state_set(round_n => $n); return }
  my $until = int(time + $opt{rest} * 3600);
  state_set(round_n => 0, paused_until => $until, pause_reason => "planned rest after $n caption files");
  logl(sprintf 'planned rest after %d caption files, until %s', $n, strftime('%a %H:%M', localtime $until));
}

# Seconds from the start of one video to the start of the next: --gap (40 s, about 90 videos an hour), half as long
# again after each pushback (up to 120 s), and 15% shorter again after each day without one.
sub gap {
  my $s = read_state();
  my $g = max($opt{gap}, $s->{gap} // $opt{gap});
  if ($g > $opt{gap} && time - ($s->{last_strike} // 0) > 86400 && time - ($s->{gap_eased} // 0) > 86400) {
    $g = max($opt{gap}, $g * 0.85);
    state_set(gap => $g, gap_eased => int time);
    logl('a day without pushback: one video every ' . int($g) . ' s');
  }
  $g;
}
sub pace {   # waits until the next video is due (jitter: 75-125% of the gap)
  my $t0 = shift;
  nap(max(3, $t0 + gap() * (0.75 + rand 0.5) - time));
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
   '--js-runtimes', 'deno:' . tool('deno'), '--extractor-args', 'youtube:skip=hls,dash,translated_subs;player_skip=js',
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
  # An entry with "videos" is a few chosen videos, not a channel (a game's cutscene movie, 3-10 hours long):
  # nothing to list, and any length is fine.
  my @urls = $c->{videos} ? ()
    : $c->{search} ? map { (my $q = $_) =~ s/ /+/g; "https://www.youtube.com/channel/$c->{id}/search?query=$q" } @{$c->{search}}
    : ("https://www.youtube.com/channel/$c->{id}/videos");
  my $tmp = "$DIR/tmp"; make_path($tmp);
  my %seen; my @e; my $failed;
  @e = map { {id => $_} } grep { !$seen{$_}++ } @{$c->{videos}} if $c->{videos};
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
  my @s = ('BEGIN;');
  my ($keep, $skip) = (0, 0);
  for my $x (@e) {
    my $d = $x->{duration};
    my $ok = (!defined $d || ($d >= 60 && $d <= max_len($c)))
      && ($x->{live_status} // '') !~ /^(is_live|is_upcoming)$/
      && title_ok($c, $x->{title});
    $ok ? $keep++ : $skip++;
    push @s, sprintf("INSERT INTO videos(id, channel, title, dur, views, status) VALUES(%s, %s, %s, %s, %d, %s) ON CONFLICT(id) DO UPDATE SET views=max(excluded.views, ifnull(videos.views, 0)), title=ifnull(excluded.title, videos.title) WHERE videos.channel=excluded.channel;",
      sql_quote($x->{id}), sql_quote($c->{key}), sql_quote($x->{title}), defined $d ? int $d : 'NULL', int($x->{view_count} // 0), sql_quote($ok ? 'later' : 'skip'));
  }
  push @s, sprintf("UPDATE channels SET listed_at=%d, listed=%d, note=NULL WHERE key=%s;", time, scalar @e, sql_quote($c->{key})), 'COMMIT;';
  sql(join "\n", @s);
  my $added = promote($c->{key});
  logl("listed $c->{name}: " . @e . " videos ($skip too short, long, live or off-topic); $added queued");
}

# Queues the most-viewed videos of a channel, up to --per-channel.
sub per_channel { my $key = shift; my $c = first { $_->{key} eq $key } channels(); $c && $c->{per} ? $c->{per} : $opt{per} }
# The longest video taken from a channel: "max" seconds (a singer's concerts and compilations are left out), else 3 h
# (chosen "videos" can be any length).
sub max_len { my $c = shift; $c->{videos} ? 1e9 : $c->{max} || 3 * 3600 }
# A channel's "titles" (must match) and "skip" (must not: a show's interviews, panels and music, a singer's
# chats and premieres) for a video title.
sub title_ok {
  my ($c, $t) = @_; $t //= '';
  (!$c->{titles} || $t =~ /$c->{titles}/) && (!$c->{skip} || $t !~ /$c->{skip}/);
}
# After channels.json changes: queued videos whose titles no longer pass are skipped (fetched ones stay; --drop),
# and skipped ones whose titles pass now go back in line (not the ones skipped for their length or dropped by hand).
sub refilter {
  for my $c (channels()) {
    my $ch = sql_quote($c->{key});
    my $max = max_len($c);
    my @k = map { $_->[0] } grep { !title_ok($c, $_->[1]) || ($_->[2] ne '' && $_->[2] > $max) }
      sql("SELECT k, title, dur FROM videos WHERE channel=$ch AND status IN ('todo','later');");
    if (@k) {
      sql(sprintf "UPDATE videos SET status='skip' WHERE k IN (%s);", join ',', @k);
      logl("$c->{name}: " . @k . " queued videos skipped (channels.json titles / skip / max)");
    }
    next if $c->{videos};
    my @back = map { $_->[0] } grep { title_ok($c, $_->[1]) }
      sql("SELECT k, title FROM videos WHERE channel=$ch AND status='skip' AND note IS NULL AND dur BETWEEN 60 AND $max;");
    if (@back) {
      sql(sprintf "UPDATE videos SET status='later' WHERE k IN (%s);", join ',', @back);
      logl("$c->{name}: " . @back . " skipped videos back in line (channels.json titles / skip)");
    }
  }
}
# Takes one video out of the index: its lines go, and it is skipped from now on.
sub drop {
  my $id = shift;
  my ($r) = sql(sprintf "SELECT k, channel, ifnull(title,''), ifnull(lines,0) FROM videos WHERE id=%s;", sql_quote($id));
  die "$id is not in the index\n" unless $r;
  my ($k, $ch, $t, $l) = @$r; my $base = $k * 100000;
  sql(join "\n", 'BEGIN;',
    "DELETE FROM win WHERE rowid BETWEEN $base AND " . ($base + 99_999) . ';',
    "DELETE FROM lines WHERE id BETWEEN $base AND " . ($base + 99_999) . ';',
    sprintf("UPDATE videos SET status='skip', lines=0, note='dropped by hand' WHERE k=%d;", $k), 'COMMIT;');
  logl("dropped $ch · $id ($l lines): $t");
  print "Dropped $ch · $id ($l lines): $t\n";
}
sub promote {
  my $key = shift;
  my ($n) = map { $_->[0] } sql(sprintf "SELECT count(*) FROM videos WHERE channel=%s AND status NOT IN ('later','skip');", sql_quote($key));
  my $room = per_channel($key) - ($n // 0);
  if ($room < 0) {   # "per" made smaller, or a looser filter queued more: the least-viewed wait again
    sql(sprintf "UPDATE videos SET status='later' WHERE k IN (SELECT k FROM videos WHERE channel=%s AND status='todo' ORDER BY views, k LIMIT %d);", sql_quote($key), -$room);
  }
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

# ---- songs ------------------------------------------------------------------------------------------------------
# Song channels ("song": true in channels.json, official music videos only): auto-captions mishear singing, and big
# hits often have no captions at all, so the words come from lrclib.net's synced lyrics (the same source as the song
# pages), and the auto-captions only tell where each line really is in this video (music videos add intros, skits,
# pauses). Uploaded (human) captions, when a video has them, are used as they are. The lyrics stay in the private
# index: never in the repo (CLAUDE.md), so sync.pl puts song picks online with their times only.
sub is_song { my $key = shift; my $c = first { $_->{key} eq $key } channels(); $c && $c->{song} ? 1 : 0 }
sub uri { my $s = shift; utf8::encode($s) if utf8::is_utf8($s); $s =~ s/([^A-Za-z0-9\-_.~])/sprintf '%%%02X', ord $1/ge; $s }
# "Taylor Swift - Opalite (Official Music Video)" -> (Taylor Swift, Opalite)
sub song_of {
  my ($title, $artist) = @_;
  my $t = $title // '';
  $t =~ s/\s*[\(\[][^\)\]]*[\)\]]//g;
  $t =~ s/\s+\|\s.*$//;   # "Elvis Presley - Suspicious Minds | Elvis '68 Comeback Special"
  $t =~ s/\s+(?:ft\.?|feat\.?|featuring)\s.*$//i;
  my ($art, $trk) = $t =~ /^(.*?)\s+[-\x{2013}\x{2014}]\s+(.+)$/ ? ($1, $2) : ($artist, $t);
  # "Simon & Garfunkel" is the artist's own name; "Calvin Harris & Rihanna" is two.
  $art =~ s/\s*(?:,|&|\bx\b|\band\b)\s.*$//i unless lc $art eq lc($artist // '');
  s/^\s+|\s+$//g for $art, $trk;
  $trk =~ s/^\Q$art\E\s+[-\x{2013}\x{2014}]\s+//i;   # "The Beatles - The Beatles - Hey Jude"
  $trk =~ s/^["\x{201C}]+|["\x{201D}]+$//g;   # Frank Sinatra - "My Way"
  ($art, $trk);
}
# The song's synced lyrics: {dur => seconds, lines => [[ms, text], …]} (empty lines are kept: they end the line before).
sub lyrics_for {
  my $i = shift;
  my ($art, $trk) = song_of($i->{title}, $i->{artist} || $i->{channel});
  return unless length $art && length $trk;
  my $tmp = "$DIR/tmp"; make_path($tmp);
  my $curl = first { -x $_ } 'C:/Windows/System32/curl.exe', '/mingw64/bin/curl', '/usr/bin/curl';
  run_cmd([$curl // 'curl', '-s', '-f', '--max-time', '20', '-A', 'caption-index/1.0 (private use)', '-o', "$tmp/lrclib.json",
    'https://lrclib.net/api/search?artist_name=' . uri($art) . '&track_name=' . uri($trk)], 40, "$tmp/lrclib.out", "$tmp/lrclib.err");
  my $res = eval { JSON::PP->new->decode(slurp("$tmp/lrclib.json")) };
  unlink "$tmp/lrclib.json";
  return unless ref $res eq 'ARRAY';
  my @c = grep { !$_->{instrumental} && ($_->{syncedLyrics} // '') =~ /^\[\d+:\d/m } @$res;
  return unless @c;
  # The version closest to this video's length (a music video is often longer than the record).
  my ($best) = sort { abs(($a->{duration} // 0) - ($i->{duration} // 0)) <=> abs(($b->{duration} // 0) - ($i->{duration} // 0)) } @c[0 .. min($#c, 5)];
  my @l;
  for (split /\n/, $best->{syncedLyrics}) { push @l, [int((($1 * 60) + $2) * 1000), $3] if /^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*?)\s*$/ }
  @l ? {dur => $best->{duration} // 0, lines => \@l, artist => $art, track => $trk} : undef;
}
# Every token the auto-captions heard, with its time: [[token, ms], …]
sub auto_words {
  my $d = shift;
  my @w;
  for my $ev (@{$d->{events} || []}) {
    next if $ev->{aAppend} || ref $ev->{segs} ne 'ARRAY';
    my $t0 = $ev->{tStartMs} // 0;
    for my $sg (@{$ev->{segs}}) { my $ms = $t0 + ($sg->{tOffsetMs} // 0); push @w, [$_, $ms] for tokens($sg->{utf8} // '') }
  }
  \@w;
}
# Where each lyric line is in this video. The start of a line (its first three words) found in the auto-captions
# gives a possible shift for that line; a chorus is found again later, so most lines have several. The shifts that
# at least two lines share are the choices, and one pass over the whole song picks a shift for every line: each line
# found at its shift counts 1, changing the shift (an intro, a skit, a pause in the video) costs 2.5, so a change
# needs about three lines that agree, and the lines stay in order (a later chorus can't pull a line forward,
# Nov 21: "You better show me now" landed a minute late). Then each found line takes its own exact time.
# Returns the shift (ms) for each line, or nothing when too few lines are found.
sub align_lyrics {
  my ($ly, $w) = @_;
  return unless @$w;
  my %at; push @{$at{$w->[$_][0]}}, $_ for 0 .. $#$w;
  my (@cand, @all);
  for my $n (0 .. $#$ly) {
    my @t = tokens($ly->[$n][1]);
    my $k = min(3, scalar @t);
    next if $k < 2;
    for my $p (@{$at{$t[0]} || []}) {
      next if $p + $k - 1 > $#$w;
      next if grep { $w->[$p + $_][0] ne $t[$_] } 1 .. $k - 1;
      my $o = $w->[$p][1] - $ly->[$n][0];
      push @{$cand[$n]}, $o; push @all, $o;
    }
  }
  my $found = grep { $cand[$_] && @{$cand[$_]} } 0 .. $#$ly;
  my $lines = grep { $_->[1] =~ /\S/ } @$ly;
  return if $found < 3 || $found < $lines * 0.15;
  # The choices: shifts that at least two lines share (within 0.8 s), each the middle of its group.
  my @g;
  for my $o (sort { $a <=> $b } @all) {
    if (@g && $o - $g[-1][-1] <= 800) { push @{$g[-1]}, $o } else { push @g, [$o] }
  }
  my @C = map { $_->[int(@$_ / 2)] } grep { @$_ >= 2 } @g;
  return unless @C;
  my $near = sub { my ($n, $c) = @_; my ($x) = sort { abs($a - $c) <=> abs($b - $c) } @{$cand[$n] || []}; defined $x && abs($x - $c) <= 1000 ? $x : undef };
  my @hit = map { my $n = $_; [map { defined $near->($n, $_) ? 1 : 0 } @C] } 0 .. $#$ly;
  my $JUMP = 2.5;
  my (@score, @back);
  $score[0] = [@{$hit[0]}];
  for my $n (1 .. $#$ly) {
    for my $k (0 .. $#C) {
      my ($best, $bj) = (-1e9, $k);
      for my $j (0 .. $#C) {
        # In order: after a change of shift this line can't start before the line before it.
        next if $j != $k && $ly->[$n][0] + $C[$k] < $ly->[$n - 1][0] + $C[$j];
        my $v = $score[$n - 1][$j] - ($j == $k ? 0 : $JUMP);
        ($best, $bj) = ($v, $j) if $v > $best;
      }
      $score[$n][$k] = $best + $hit[$n][$k];
      $back[$n][$k] = $bj;
    }
  }
  my $k = 0;
  for (1 .. $#C) { $k = $_ if $score[$#$ly][$_] > $score[$#$ly][$k] }
  my @path;
  for (my $n = $#$ly; $n >= 0; $n--) { $path[$n] = $k; $k = $back[$n][$k] if $n > 0 }
  my $matched = grep { $hit[$_][$path[$_]] } 0 .. $#$ly;
  return if $matched < 3 || $matched < $lines * 0.15;
  # Each found line its own exact shift; the others the shift of their part of the video.
  [map { my $c = $C[$path[$_]]; $near->($_, $c) // $c } 0 .. $#$ly];
}
# The lyric lines as index lines: each from its time (shifted) to the next line's (an empty lyric line ends it), at
# most 10 s; the words as the lyrics write them.
sub lyric_lines {
  my ($ly, $off) = @_;
  my @L;
  for my $n (0 .. $#$ly) {
    next unless $ly->[$n][1] =~ /\S/;
    my $s = $ly->[$n][0] + $off->[$n];
    next if $s < 0;
    my $e = $n < $#$ly ? $ly->[$n + 1][0] + $off->[$n + 1] : $s + 5000;
    $e = $s + 10000 if $e > $s + 10000 || $e <= $s;
    push @L, {s => int $s, e => int $e, text => $ly->[$n][1], w => undef};
  }
  \@L;
}

sub errors { join "\n", grep { !/ffmpeg not found|Incomplete data received|re-fetching using API/ } split /\n/, slurp(shift) }
sub first_error { my @l = split /\n/, shift; (grep { /ERROR/ } @l)[0] // (grep { /\S/ } @l)[0] }
sub pushed_back {
  my ($v, $err) = @_;
  strike((grep { $_ =~ $RATE } split /\n/, $err)[0]);
  set_video($v->{k}, tries => $v->{tries} + 1, note => 'pushed back on this one');
  if ($v->{tries} + 1 >= 3) { set_video($v->{k}, status => 'gone', note => 'pushed back 3 times on this one') }
  'rate';
}
sub failed {   # tried 3 times: left out
  my ($v, $why) = @_;
  my $t = $v->{tries} + 1;
  set_video($v->{k}, tries => $t, note => substr($why, 0, 200), ($t >= 3 ? (status => 'error') : ()));
  'error';
}

# One video in two steps, so YouTube's caption server gets exactly one request a video (none when there are no
# English captions; it is the server that said 429 first, on Nov 19):
#   1. the video's details and its list of caption tracks: the watch page and two player requests (YouTube's 2 MB
#      player script is skipped: it is only needed for the video itself, not for captions; ytdlp_base);
#   2. the one track we keep, downloaded from the details saved in step 1 (no other request).
# Returns 'done', 'none' (no English captions), 'gone', 'error' or 'rate' (YouTube pushed back).
sub fetch_video {
  my $v = shift;
  my $id = $v->{id};
  my $tmp = "$DIR/tmp/v"; remove_tree($tmp); make_path($tmp);
  my $json = "$tmp/$id.info.json";
  my $rc = run_cmd([ytdlp_base(), '--skip-download', '--write-info-json', '--sleep-requests', '0.75',
    '-o', "$tmp/%(id)s", "https://www.youtube.com/watch?v=$id"], 300, "$tmp/out.txt", "$tmp/err.txt");
  my $err = errors("$tmp/err.txt");
  return pushed_back($v, $err) if $err =~ $RATE;
  my $i = -e $json ? eval { JSON::PP->new->decode(slurp($json)) } : undef;
  if (!$i) {
    my $first = first_error($err);
    if ($err =~ $GONE) { set_video($v->{k}, status => 'gone', note => substr($first // 'unavailable', 0, 200)); return 'gone' }
    return failed($v, $first // "yt-dlp exit $rc");
  }
  my %f = (title => $i->{title}, dur => int($i->{duration} // 0), views => int($i->{view_count} || $v->{views} || 0),
    uploaded => $i->{upload_date}, lang => $i->{language},
    embed => (ref $i->{playable_in_embed} ? ($i->{playable_in_embed} ? 1 : 0) : undef));
  # A track YouTube translated from another language (tlang= in its address) is never kept: a video with dubbed
  # audio (Jubilee, Dhar Mann) calls its Bangla-to-English translation "en" and the English original "en-orig".
  my $has = sub { my ($subs, $l) = @_;
    grep { ($_->{ext} // '') eq 'json3' && ($_->{url} // '') !~ /[?&]tlang=/ } @{(ref $subs eq 'HASH' ? $subs : {})->{$l} || []} };
  my ($lang, $kind);
  # Uploaded tracks can also be called "en-eEY6OEpapPo" (Breaking Bad's channel): any other en-… track comes next.
  my @en = grep { /^en-/ && !/^en-(US|CA|GB|AU)$/ } sort keys %{ref $i->{subtitles} eq 'HASH' ? $i->{subtitles} : {}};
  for my $l ('en', 'en-US', 'en-CA', 'en-GB', 'en-AU', @en) { if ($has->($i->{subtitles}, $l)) { ($lang, $kind) = ($l, 'human'); last } }
  if (!$lang && ($i->{language} // 'en') =~ /^en/) {
    for my $l ('en-orig', 'en', 'en-US-orig', 'en-US') { if ($has->($i->{automatic_captions}, $l)) { ($lang, $kind) = ($l, 'auto'); last } }
  }
  # A song with no captions at all (big hits often have none): its synced lyrics, when the video is the record itself
  # (same length); a music video with a different cut can't be lined up without captions.
  my $song = is_song($v->{channel});
  if (!$lang && $song) {
    my $ly = lyrics_for($i);
    if ($ly && abs(($ly->{dur} // 0) - ($i->{duration} // 0)) <= 2) {
      my $lines = lyric_lines($ly->{lines}, [map { 0 } @{$ly->{lines}}]);
      if (@$lines) {
        store_lines($v, $lines, %f, kind => 'lyrics');
        logl(sprintf '%s · %s · lyrics (no captions; same length as the record) · %d lines · %s', $v->{channel}, $id, scalar @$lines, $i->{title} // '');
        return 'done';
      }
    }
  }
  if (!$lang) {
    set_video($v->{k}, %f, status => 'none', fetched_at => int time,
      note => ($i->{language} && $i->{language} !~ /^en/ ? "spoken language: $i->{language}" : $song ? 'no captions, and no lyrics of the same length' : 'no English captions'));
    return 'none';
  }
  # Without its watch-page address, yt-dlp can't fall back to fetching the whole video again when the caption file
  # fails (it did on Nov 19: "The info failed to download …; trying with URL …"), which would be more requests.
  delete $i->{webpage_url};
  my $json2 = "$tmp/$id.step2.json";
  open my $h, '>:encoding(UTF-8)', $json2 or return failed($v, "can't write $json2: $!");
  print $h JSON::PP->new->encode($i); close $h;
  $rc = run_cmd([ytdlp_base(), '--load-info-json', $json2, '--skip-download',
    ($kind eq 'human' ? '--write-subs' : '--write-auto-subs'), '--sub-langs', $lang, '--sub-format', 'json3',
    '-o', "subtitle:$tmp/%(id)s", '-o', "$tmp/%(id)s"], 120, "$tmp/out2.txt", "$tmp/err2.txt");
  $err = errors("$tmp/err2.txt");
  return pushed_back($v, $err) if $err =~ $RATE;
  count_caption();
  my $file = "$tmp/$id.$lang.json3";
  my $d = -e $file ? eval { JSON::PP->new->decode(slurp($file)) } : undef;
  return failed($v, 'captions not downloaded: ' . (first_error($err) // "yt-dlp exit $rc")) unless $d;
  my $lines = $kind eq 'auto' ? auto_lines($d) : human_lines($d);
  # A song with only auto-captions (they mishear singing): the real lyrics, lined up with the captions' word times.
  if ($song && $kind eq 'auto') {
    my $ly = lyrics_for($i);
    my $off = $ly ? align_lyrics($ly->{lines}, auto_words($d)) : undef;
    if ($off) {
      my $ll = lyric_lines($ly->{lines}, $off);
      if (@$ll >= 4) { $lines = $ll; $kind = 'lyrics' }
    }
    logl("$v->{channel} · $id · " . ($ly ? ($kind eq 'lyrics' ? 'lyrics lined up with the auto-captions' : "lyrics found but they don't line up: auto-captions kept") : 'no lyrics on lrclib: auto-captions kept'));
  }
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
  refilter();
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
  my %first = map { $_ => 1 } first_keys();
  my @unlisted = grep { $known->{$_} } map { $_->[0] } sql("SELECT key FROM channels WHERE listed_at IS NULL OR listed_at < $old ORDER BY listed_at IS NOT NULL, listed_at, rowid;");
  @unlisted = ((grep { $first{$_} } @unlisted), (grep { !$first{$_} } @unlisted));
  my $row = sub { my %v; @v{qw(k id channel tries lines views)} = @{$_[0]}; \%v };
  # Longest videos first (of each channel's most-viewed): one caption request gives up to 3 hours of speech.
  # "first" channels (a show a student loves, songs): 12 of their videos at a time, before anything else, the
  # channels taking turns (a long show doesn't keep the songs waiting).
  my $in = join ',', map { sql_quote($_) } grep { $known->{$_} } keys %first;
  my @batch = $in ? map { $row->($_) } sql("SELECT k, id, channel, tries, ifnull(lines,0), views FROM (SELECT *, row_number() OVER (PARTITION BY channel ORDER BY dur IS NOT NULL, dur DESC, views DESC, k) r FROM videos WHERE status='todo' AND channel IN ($in)) ORDER BY r, dur IS NOT NULL, dur DESC LIMIT 12;") : ();
  @batch = map { $row->($_) } grep { $known->{$_->[2]} } sql("SELECT k, id, channel, tries, ifnull(lines,0), views FROM (SELECT *, row_number() OVER (PARTITION BY channel ORDER BY dur IS NULL, dur DESC, views DESC, k) r FROM videos WHERE status='todo') WHERE r=1;")
    unless @batch;
  if (@unlisted && $first{$unlisted[0]}) { $run->{since_list} = 12 }   # a "first" channel is listed at once
  if (@unlisted && ($run->{since_list} >= 12 || !@batch)) {   # a new channel after every 12 videos
    my ($c) = grep { $_->{key} eq $unlisted[0] } channels();
    my $t0 = time;
    list_channel($c);
    $run->{since_list} = 0;
    pace($t0);
    return;
  }
  if (!@batch) { logl('nothing left to fetch; looking again in 6 hours'); nap(6 * 3600); return }
  for my $v (shuffle @batch) {
    exit_if_stopped();
    wait_if_paused();
    my $t0 = time;
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
    pace($t0);
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
  print "Page: http://localhost:8770 (search and play the clips; only on this PC)\n";
  my %n = map { $_->[0] => $_->[1] } sql("SELECT status, count(*) FROM videos GROUP BY status;");
  my %k = map { $_->[0] => $_->[1] } sql("SELECT kind, count(*) FROM videos WHERE status='done' GROUP BY kind;");
  my ($lines) = map { $_->[0] } sql("SELECT ifnull(sum(lines),0) FROM videos WHERE status='done';");
  printf "Searchable: %s videos (%s with human captions, %s auto), %s lines\n", commas($n{done}), commas($k{human}), commas($k{auto}), commas($lines);
  printf "Left out: %s without English captions, %s unavailable, %s failed 3 times\n", commas($n{none}), commas($n{gone}), commas($n{error});
  my ($listed, $all) = map { @$_ } sql("SELECT count(listed_at), count(*) FROM channels;");
  my ($last_hour) = map { $_->[0] } sql(sprintf "SELECT count(*) FROM videos WHERE fetched_at > %d;", time - 3600);
  printf "Queue: %s to fetch (the %d most-viewed of each channel); %d of %d channels listed; %s fetched in the last hour\n",
    commas($n{todo}), $opt{per}, $listed, $all, commas($last_hour);
  for my $c (grep { $_->{first} } channels()) {
    my ($done, $todo, $hours, $listed_at) = map { @$_ } sql(sprintf "SELECT sum(v.status='done'), sum(v.status='todo'), round(sum(CASE WHEN v.status='done' THEN v.dur END) / 3600.0, 1), c.listed_at FROM channels c LEFT JOIN videos v ON v.channel=c.key WHERE c.key=%s;", sql_quote($c->{key}));
    printf "First: %s: %s videos searchable (%s h), %s to fetch%s\n", $c->{name}, $done || 0, $hours || 0, $todo || 0,
      $listed_at ? '' : ' (not listed yet: it is listed first)';
  }
  my $g = max($opt{gap}, $s->{gap} // $opt{gap});
  my $left = ($n{todo} // 0) + ($all - $listed) * $opt{per} * 0.9;   # channels not listed yet: about 360 each
  my $size = min($opt{round}, $s->{round_size} // $opt{round});
  my $per_day = 24 * $size / ($size * $g / 3600 + $opt{rest});
  printf "Pace: a video every %d s, a %s-hour rest after every %d (%d more until the next one): about %d a day;\n" .
    "  about %.0f more days of running%s\n", $g, $opt{rest}, $size, max(0, $size - ($s->{round_n} // 0)), $per_day,
    $left / $per_day, $all > $listed ? ' (with the channels not listed yet)' : '';
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
  # The page and the sync run all the time: stop them first, so the new copies start below (the collector is left
  # running: its new copy starts at its next start, as before).
  system('powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
    q{Get-CimInstance Win32_Process -Filter "Name='perl.exe'" | Where-Object { $_.CommandLine -match 'caption-index\\\\(site|sync)\.pl' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }});
  for my $f (qw(collect.pl search.pl CaptionIndex.pm WordForms.pm channels.json site.pl site.html sync.pl)) {
    copy("$BIN/$f", "$to/$f") or die "can't copy $f to $to: $!\n";
  }
  # The clip library's player, for the page when there is no internet (site.pl takes the live one when it can).
  make_path("$to/player");
  # The caption editor (✎ Captions), shared with the picks page online.
  copy("$BIN/../../../docs/real-video/picks/caps.js", "$to/caps.js") or warn "can't copy the caption editor caps.js: $!\n";
  for my $f (qw(index.html app.js)) {
    copy("$BIN/../../../docs/real-video/$f", "$to/player/$f") or warn "can't copy the clip player's $f: $!\n";
  }
  print "Copied the collector and the page to $to\n";
  hidden_task($to, $TASK, 'collect.pl', 'run-hidden.vbs',
    'Private caption index (craneberries tools/real-video/index): fetches YouTube captions slowly, logged out. Stop: perl collect.pl --stop');
  print "Scheduled task \"$TASK\" made (at logon and every hour, hidden).\n";
  hidden_task($to, $SITE_TASK, 'site.pl', 'run-site.vbs',
    'The private caption index as a page on this PC only: http://localhost:8770 (site.pl)');
  print "Scheduled task \"$SITE_TASK\" made: the page is at http://localhost:8770 (at logon and every hour, hidden).\n";
  hidden_task($to, $SYNC_TASK, 'sync.pl', 'run-sync.vbs',
    'His liked and re-timed clips, synced both ways with docs/real-video/picks/picks.json on GitHub (sync.pl)');
  print "Scheduled task \"$SYNC_TASK\" made: liked and re-timed clips go online by themselves.\n";
  local $ENV{MSYS_NO_PATHCONV} = 1; local $ENV{MSYS2_ARG_CONV_EXCL} = '*';
  `schtasks /run /tn "$SITE_TASK" 2>&1`;   # now (a second copy just exits)
  `schtasks /run /tn "$SYNC_TASK" 2>&1`;
}

# A scheduled task that runs one of these scripts with no window, at logon and again every hour if it stopped.
sub hidden_task {
  my ($to, $name, $file, $vbsfile, $desc) = @_;
  my $perl = -x '/usr/bin/perl.exe' ? `cygpath -w /usr/bin/perl.exe` : $^X;   # Git for Windows' Perl
  chomp $perl;
  die "can't find perl.exe (got $perl)\n" unless $perl =~ /^[A-Za-z]:\\.*perl\.exe$/i;
  (my $script = "$to/$file") =~ s{/}{\\}g;
  # Perl is a console program: wscript starts it with no window at all (0) and waits for it (True), so the task
  # shows as running while it works. (conhost --headless doesn't start anything from the Task Scheduler.)
  (my $vbs = "$to/$vbsfile") =~ s{/}{\\}g;
  open my $v, '>', "$to/$vbsfile" or die "can't write $to/$vbsfile: $!\n";
  print $v qq{' Starts $file with no window (made by collect.pl --install)\r\n},
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
Register-ScheduledTask -TaskName '$name' -Action \$a -Trigger \$t1,\$t2 -Settings \$s -Principal \$p -Force -Description '$desc' | Out-Null
PS
  require Encode; require MIME::Base64;
  my $b64 = MIME::Base64::encode_base64(Encode::encode('UTF-16LE', $ps), '');
  system('powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', $b64);
  die "Making the scheduled task \"$name\" failed.\n" if $?;
}
