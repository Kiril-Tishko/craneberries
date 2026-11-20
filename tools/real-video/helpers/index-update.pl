#!/usr/bin/env perl
# Adds or updates words' lines in docs/real-video/words/index.json (for a PC without Python's build_index.py), keeping
# every other line as it is: no re-sorting, so his edits from the page stay put. n = clips not hidden.
#   perl tools/real-video/helpers/index-update.pl <slug> <slug> …
use strict; use warnings;
use JSON::PP;
my $dir = 'docs/real-video/words'; my $idx = "$dir/index.json";
open my $fh, '<:raw', $idx or die "$idx: $!"; my @lines = <$fh>; close $fh;
s/\r\n$/\n/ for @lines;
my $J = JSON::PP->new->utf8;
for my $slug (@ARGV) {
  open my $wf, '<:raw', "$dir/$slug.json" or die "$slug: $!"; my $w = do { local $/; JSON::PP->new->utf8->decode(<$wf>) }; close $wf;
  my $n = grep { !$_->{hidden} } @{$w->{clips} // []};
  my $line = '  {"slug":' . $J->encode($slug) . ',"en":' . $J->encode($w->{en}) . ',"ua":' . $J->encode($w->{ua})
    . ',"pic":' . $J->encode($w->{pic} // '') . ',"n":' . $n . '}';
  my ($at) = grep { $lines[$_] =~ /^\s*\{"slug":"\Q$slug\E"/ } 0 .. $#lines;
  if (defined $at) { my $comma = $lines[$at] =~ /,\s*$/ ? ',' : ''; $lines[$at] = "$line$comma\n"; next }
  my ($before) = grep { $lines[$_] =~ /^\s*\{"slug":"([^"]+)"/ && $1 gt $slug } 0 .. $#lines;
  if (defined $before) { splice @lines, $before, 0, "$line,\n" }
  else { my ($last) = grep { $lines[$_] =~ /^\s*\{"slug"/ } reverse 0 .. $#lines; $lines[$last] =~ s/\s*$/,\n/; splice @lines, $last + 1, 0, "$line\n" }
}
open my $out, '>:raw', $idx or die; print $out @lines; close $out;
JSON::PP->new->utf8->decode(join '', @lines);   # still valid
print scalar(@ARGV), " updated\n";
