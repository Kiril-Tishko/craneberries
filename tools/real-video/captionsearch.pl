#!/usr/bin/env perl
# Find real video clips for a word with Caption Search's API (captionsearch.app, his free trial key):
#   perl tools/real-video/captionsearch.pl "is mandatory" [how many, 1-5, default 5] [--raw] [--fresh]
# For each match: the channel and video title, a YouTube link with the time (paste it in the clip page's "add a clip"),
# the exact start and end of the matching line, and the line with up to two lines before and after it, with times
# (the API's "include": "context", which Dunqing turned on for his trial on Nov 18). --raw prints the whole answer.
# Caption text from auto-captions often repeats itself ("What do you mean? What do you mean?"); the tool shows it
# once, so check the real line in the clip page before saving it.
#
# The key is his, from Caption Search: the CAPTIONSEARCH_API_KEY environment variable, or the file
# ~/.captionsearch-key (on his PC: C:\Users\TKS\.captionsearch-key.txt, one line). In a cloud chat, a Network secret
# for api.captionsearch.app in the cloud environment's settings: the proxy adds it and the chat never sees it, so the
# tool sends no key there. Never put it in this repo (public), a page, a commit or a chat, and never print it.
# Trial: 5 requests a minute, 30 a day, at most 5 results a search and no next page (a bigger "limit" or an "offset"
# gets 400). For more choice, search other phrases that give the meaning ("what do you mean by that", "wait, what do
# you mean"). Every answer is kept in ~/.cache/captionsearch/, so the same phrase again costs nothing (--fresh asks
# again). On "429 Too Many Requests" it says how long to wait (Retry-After) and stops.
# Then watch each clip in the clip page before choosing it, as CLAUDE.md says.
use strict; use warnings; use utf8;
use JSON::PP; use File::Path qw(make_path); use IPC::Open2 qw(open2); use Digest::MD5 qw(md5_hex);
binmode STDOUT, ':encoding(UTF-8)'; binmode STDERR, ':encoding(UTF-8)';

my @args = grep { !/^--/ } @ARGV;
my %opt = map { $_ => 1 } grep { /^--/ } @ARGV;
my ($phrase, $limit) = @args;
die "usage: perl tools/real-video/captionsearch.pl \"phrase\" [how many, 1-5] [--raw] [--fresh]\n" unless defined $phrase && $phrase =~ /\S/;
utf8::decode($phrase);
$limit = 5 unless defined $limit && $limit =~ /^\d+$/;
$limit = 5 if $limit > 5; $limit = 1 if $limit < 1;

my $home = $ENV{HOME} || $ENV{USERPROFILE} || '.';
my $cache = "$home/.cache/captionsearch";
my $file = "$cache/" . md5_hex(do { my $p = lc $phrase; utf8::encode($p); "$p|$limit|context" }) . '.json';

my $body;
if (-e $file && !$opt{'--fresh'}) {
  open my $h, '<:raw', $file or die "can't read $file: $!\n"; local $/; $body = <$h>;
  print "(from the cache: no request used)\n";
} else {
  my $key = $ENV{CAPTIONSEARCH_API_KEY};
  if (!$key) {
    for my $f ("$home/.captionsearch-key", "$home/.captionsearch-key.txt") {
      next unless -e $f;
      open my $h, '<', $f or next; local $/; $key = <$h>; last;
    }
  }
  $key = '' unless defined $key;
  $key =~ s/^\s+|\s+$//g; $key =~ s/^\x{FEFF}//; $key =~ s/^\xEF\xBB\xBF//;
  # In a cloud chat the key is a Network secret for api.captionsearch.app: the proxy adds it, the chat never sees it.
  my $cloud = ($ENV{CLAUDE_CODE_REMOTE} // '') =~ /^(1|true)$/i;
  die "No Caption Search key: set CAPTIONSEARCH_API_KEY, or put the key alone in $home/.captionsearch-key\n" unless $key || $cloud;

  # The key and the query go to curl on its standard input (a curl config), never on the command line or in a file.
  my $data = JSON::PP->new->utf8->canonical->encode({phrase => $phrase, limit => $limit + 0, include => "context"});
  my $q = sub { my $s = shift; $s =~ s/(["\\])/\\$1/g; "\"$s\"" };
  my $config = join '', map { "$_\n" } 'silent', 'show-error', 'request = "POST"',
    ($key ? 'header = ' . $q->("Authorization: Bearer $key") : ()), 'header = "Content-Type: application/json"',
    'data-binary = ' . $q->($data), 'write-out = "\n@@%{http_code} %header{retry-after}"', 'url = "https://api.captionsearch.app/v1/search"';
  my $pid = open2(my $from, my $to, 'curl', '--config', '-');
  binmode $to; print $to $config; close $to;
  binmode $from; my $out = do { local $/; <$from> }; waitpid $pid, 0;
  $out //= '';
  my ($code, $wait) = $out =~ /\n\@\@(\d{3}) ?(\S*)\s*$/;
  $code //= 0;
  ($body = $out) =~ s/\n\@\@\d{3}.*\z//s;
  die "Caption Search: too many requests (5 a minute, 30 a day). Wait " . ($wait ? "$wait seconds" : 'a minute')
    . " and try again.\n" if $code == 429;
  die "Caption Search didn't take the key (401)." . ($cloud ? " In a cloud chat it must be a Network secret for"
    . " api.captionsearch.app in the environment's settings." : '') . "\n" if $code == 401;
  die "Caption Search answered " . ($code || 'nothing') . ": " . substr($body, 0, 300) . "\n" unless $code == 200;
  make_path($cache);
  open my $w, '>:raw', $file or die "can't write $file: $!\n"; print $w $body; close $w;
}

my $d = eval { JSON::PP->new->utf8->decode($body) } or die "Caption Search's answer isn't JSON: " . substr($body, 0, 200) . "\n";
if ($opt{'--raw'}) { print JSON::PP->new->utf8(0)->canonical->pretty->encode($d); exit; }

my $m = ref $d eq 'HASH' && ref $d->{results} eq 'ARRAY' ? $d->{results} : [];
print "No matches for \"$phrase\".\n" unless @$m;

my $num = sub { my $v = shift; defined $v && $v =~ /^-?[\d.]+$/ ? sprintf('%.2f', $v) : '?' };
my $time = sub {
  my $v = shift; return '?' unless defined $v && $v =~ /^[\d.]+$/;
  my $t = int $v; $t >= 3600 ? sprintf('%d:%02d:%02d', $t / 3600, $t / 60 % 60, $t % 60) : sprintf('%d:%02d', $t / 60, $t % 60);
};
# Auto-captions repeat themselves and carry zero-width spaces: show each line once, plainly.
my $clean = sub {
  my $t = shift // ''; $t =~ s/[\x{200B}-\x{200D}\x{FEFF}]//g; $t =~ s/\s+/ /g; $t =~ s/^ | $//g;
  1 while $t =~ s/(.{8,}?) \1(?= |$)/$1/;
  $t;
};

my $n = 0;
for my $x (@$m) {
  my $c = ref $x->{captions} eq 'HASH' ? $x->{captions} : {};
  my $hit = ref $c->{match} eq 'HASH' ? $c->{match} : {};
  my ($s, $e) = ($hit->{startSeconds} // $x->{startSeconds}, $hit->{endSeconds} // $x->{endSeconds});
  my $yt = "https://youtu.be/$x->{videoId}" . (defined $s && $s =~ /^[\d.]+$/ ? '?t=' . int($s) : '');
  printf "%d. %s · %s\n   %s   (%s, %s-%s)\n", ++$n, $x->{channelName} // '?', $clean->($x->{videoTitle} // ''),
    $yt, $x->{videoId}, $num->($s), $num->($e);
  my ($last, @rows) = ('');
  for ([' ', $c->{preceding}], ['>>', [$hit]], [' ', $c->{following}]) {
    my ($mark, $list) = @$_;
    for my $l (ref $list eq 'ARRAY' ? @$list : ()) {
      next unless ref $l eq 'HASH' && defined $l->{text};
      my $t = $clean->($l->{text});
      next if $t eq '' || ($t eq $last && $mark ne '>>');
      $last = $t;
      push @rows, sprintf "   %-2s %8s  %s\n", $mark, $time->($l->{startSeconds}), $t;
    }
  }
  print @rows ? @rows : "      (no caption text)\n";
}
