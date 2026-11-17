#!/usr/bin/env perl
# Find real video clips for a word with Caption Search's API (captionsearch.app, his free trial key):
#   perl tools/real-video/captionsearch.pl "is mandatory" [how many, 1-20, default 10] [--raw] [--fresh]
# One match per line: the YouTube id, start and end in seconds (end is approximate, "?" when unknown), the link to that
# moment (Looplines), and any caption text the match has. --raw prints the whole answer.
#
# The key is his, from Caption Search: the CAPTIONSEARCH_API_KEY environment variable, or the file
# ~/.captionsearch-key (on his PC: C:\Users\TKS\.captionsearch-key, one line). In a cloud chat, the cloud environment's
# variables. Never put it in this repo (public), a page, a commit or a chat, and never print it.
# Trial: 5 requests a minute, 30 a day. Every answer is kept in ~/.cache/captionsearch/, so the same phrase again costs
# nothing (--fresh asks again). On "429 Too Many Requests" it says how long to wait (Retry-After) and stops.
# The search gives times only: read the lines around each moment (the link, or YouTube's transcript) before choosing a
# clip and writing its note, and watch it in the clip page, as CLAUDE.md says.
use strict; use warnings;
use JSON::PP; use File::Path qw(make_path); use IPC::Open2 qw(open2); use Digest::MD5 qw(md5_hex);
binmode STDOUT, ':encoding(UTF-8)'; binmode STDERR, ':encoding(UTF-8)';

my @args = grep { !/^--/ } @ARGV;
my %opt = map { $_ => 1 } grep { /^--/ } @ARGV;
my ($phrase, $limit) = @args;
die "usage: perl tools/real-video/captionsearch.pl \"phrase\" [how many] [--raw] [--fresh]\n" unless defined $phrase && $phrase =~ /\S/;
utf8::decode($phrase);
$limit = 10 unless defined $limit && $limit =~ /^\d+$/;
$limit = 20 if $limit > 20; $limit = 1 if $limit < 1;

my $home = $ENV{HOME} || $ENV{USERPROFILE} || '.';
my $cache = "$home/.cache/captionsearch";
my $file = "$cache/" . md5_hex(do { my $p = lc $phrase; utf8::encode($p); "$p|$limit" }) . '.json';

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
  die "No Caption Search key: set CAPTIONSEARCH_API_KEY, or put the key alone in $home/.captionsearch-key\n" unless $key;

  # The key and the query go to curl on its standard input (a curl config), never on the command line or in a file.
  my $data = JSON::PP->new->utf8->canonical->encode({phrase => $phrase, limit => $limit + 0});
  my $q = sub { my $s = shift; $s =~ s/(["\\])/\\$1/g; "\"$s\"" };
  my $config = join '', map { "$_\n" } 'silent', 'show-error', 'request = "POST"',
    'header = ' . $q->("Authorization: Bearer $key"), 'header = "Content-Type: application/json"',
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
  die "Caption Search answered " . ($code || 'nothing') . ": " . substr($body, 0, 300) . "\n" unless $code == 200;
  make_path($cache);
  open my $w, '>:raw', $file or die "can't write $file: $!\n"; print $w $body; close $w;
}

my $d = eval { JSON::PP->new->utf8->decode($body) } or die "Caption Search's answer isn't JSON: " . substr($body, 0, 200) . "\n";
if ($opt{'--raw'}) { print JSON::PP->new->utf8(0)->canonical->pretty->encode($d); exit; }

# The matches: the first list of objects with a videoId, wherever the answer keeps it.
my $find; $find = sub {
  my $x = shift;
  if (ref $x eq 'ARRAY') { return $x if @$x && ref $x->[0] eq 'HASH' && exists $x->[0]{videoId}; for (@$x) { my $y = $find->($_); return $y if $y; } }
  if (ref $x eq 'HASH') { for (sort keys %$x) { my $y = $find->($x->{$_}); return $y if $y; } }
  return undef;
};
my $m = $find->($d) || [];
print "No matches for \"$phrase\".\n" unless @$m;
my $num = sub { my $v = shift; defined $v && $v =~ /^-?[\d.]+$/ ? sprintf('%.2f', $v) : '?' };
for my $x (@$m) {
  my ($text) = grep { defined && !ref && /\S/ } map { $x->{$_} } qw(text line caption snippet transcript);
  printf "%s  %s–%s  %s%s\n", $x->{videoId}, $num->($x->{startSeconds}), $num->($x->{endSeconds}), $x->{url} // '',
    defined $text ? "  | $text" : '';
}
