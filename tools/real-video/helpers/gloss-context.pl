#!/usr/bin/env perl
# Gives a word its own gloss in one line, keeping its usual one: turns "the": "…" into {"*": "…", "<words>": "…"}, or
# adds a key to an object that is already there. Reads a UTF-8 file, one change a line, tab-separated:
#   <slug>	<word>	<words around it in that line>	<gloss for that line>
#   perl tools/real-video/helpers/gloss-context.pl <changes.tsv>
use strict; use warnings;
use JSON::PP;
my $J = JSON::PP->new->utf8;
open my $in, '<:encoding(UTF-8)', shift or die; my @ch = <$in>; close $in;   # characters: $J->encode makes the bytes
for (@ch) {
  s/\r?\n$//; next unless /\S/;
  my ($slug, $k, $ctx, $val) = split /\t/;
  my $f = "docs/real-video/words/$slug.json";
  open my $fh, '<:raw', $f or die "$f: $!"; my @l = <$fh>; close $fh;
  my $done = 0; my $kk = $J->encode($k);
  for (@l) {
    next unless /^    \Q$kk\E: /;
    my $comma = /,\s*$/ ? ',' : ''; (my $body = $_) =~ s/^    \Q$kk\E: //; $body =~ s/,?\s*$//;
    my $pair = $J->encode($ctx) . ': ' . $J->encode($val);
    if ($body =~ /^\{/) { $body =~ s/\}$/, $pair}/ } else { $body = "{\"*\": $body, $pair}" }
    $_ = "    $kk: $body$comma\n"; $done = 1; last;
  }
  print "$slug $k: ", ($done ? 'ok' : 'NOT FOUND'), "\n";
  open my $out, '>:raw', $f or die; print $out @l; close $out;
  $J->decode(join '', @l);
}
