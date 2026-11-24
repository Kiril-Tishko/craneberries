#!/usr/bin/env perl
# Adds clips (with their glosses and together phrases) to word files, in the files' own layout (one gloss entry and one
# clip per line, as edit.js saves it). Nothing already there is changed: a gloss key that exists is skipped and shown.
#   perl tools/real-video/helpers/add-clips.pl <spec.json> [--show]
# spec = {slug: {"together": [[phrase, ua]…], "gloss": [[word, value]…], "clips": [{v,s,e,line,note,noteUa,around}…]}}
# (glosses as pairs, so they keep their order; a value is a string or {"*": …, "<words around>": …}).
# --show prints, for the new lines, each word whose gloss was already there, so it can be checked for that line.
use strict; use warnings; use utf8;
use JSON::PP;
binmode STDOUT, ':encoding(UTF-8)';
my ($specf, $show) = @ARGV; my $dir = 'docs/real-video/words';
open my $sf, '<:raw', $specf or die "$specf: $!"; my $spec = do { local $/; JSON::PP->new->utf8->decode(<$sf>) }; close $sf;
my $B = JSON::PP->new->utf8->canonical(1);           # bytes, for the file
my $C = JSON::PP->new->canonical(1);                 # characters, for printing
sub enc { my ($x, $J) = @_; $J //= $B; return $J->encode($x) unless ref $x eq 'HASH';
  my @k = ((exists $x->{'*'} ? ('*') : ()), sort grep { $_ ne '*' } keys %$x);
  return '{' . join(', ', map { $J->encode($_) . ': ' . $J->encode($x->{$_}) } @k) . '}'; }
sub clip { my $c = shift; my @k = grep { exists $c->{$_} } qw(v s e line note noteUa around ctx hidden tall song);
  return '{' . join(',', map { $B->encode($_) . ':' . $B->encode($c->{$_}) } @k) . '}'; }
for my $slug (sort keys %$spec) {
  my $f = "$dir/$slug.json"; open my $fh, '<:raw', $f or die "$f: $!"; my $t = do { local $/; <$fh> }; close $fh;
  $t =~ s/\r\n/\n/g;
  my $w = JSON::PP->new->utf8->decode($t); my $s = $spec->{$slug}; my %added;
  for my $p (@{$s->{together} || []}) {
    my ($k, $v) = @$p; next if exists(($w->{together} || {})->{$k});
    my $pair = $B->encode($k) . ':' . $B->encode($v);
    if ($t =~ /^  "together": \{(.*)\},\n/m) { my $in = $1; my $new = $in eq '' ? $pair : "$in,$pair"; $t =~ s/^  "together": \{.*\},\n/  "together": {$new},\n/m }
    elsif ($t =~ /^  "gloss": \{/m) { $t =~ s/^  "gloss": \{/  "together": {$pair},\n  "gloss": {/m }
    else { $t =~ s/^  "clips": \[/  "together": {$pair},\n  "clips": [/m }
    $w->{together}{$k} = $v; $added{lc $_} = 1 for split /\s+/, $k;
  }
  my @add;
  for my $p (@{$s->{gloss} || []}) {
    my ($k, $v) = @$p;
    if (exists(($w->{gloss} || {})->{$k})) { print "$slug: \"$k\" already glossed: ", enc($w->{gloss}{$k}, $C), "\n"; next }
    $added{$k} = 1; push @add, '    ' . $B->encode($k) . ': ' . enc($v); $w->{gloss}{$k} = $v;
  }
  if (@add) {
    if ($t =~ /^  "gloss": \{\n(.*?)\n  \},\n/ms) { my $body = $1; $t =~ s/^  "gloss": \{\n\Q$body\E\n  \},\n/  "gloss": {\n$body,\n@{[join(",\n", @add)]}\n  },\n/ms }
    else { $t =~ s/^  "clips": \[/  "gloss": {\n@{[join(",\n", @add)]}\n  },\n  "clips": [/m }
  }
  my @c = map { '    ' . clip($_) } @{$s->{clips} || []};
  if (@c) {
    if ($t =~ /^  "clips": \[\]/m) { $t =~ s/^  "clips": \[\]/  "clips": [\n@{[join(",\n", @c)]}\n  ]/m }
    else { $t =~ s/\n  \]\n\}\s*$/,\n@{[join(",\n", @c)]}\n  ]\n}\n/ or die "$slug: can't find the end of the clips\n" }
  }
  JSON::PP->new->utf8->decode($t);
  open my $out, '>:raw', $f or die; print $out $t; close $out;
  print "$slug: +", scalar(@c), " clips, +", scalar(@add), " glosses\n";
  next unless $show;
  my $G = $w->{gloss} || {};
  for my $c (@{$s->{clips} || []}) { for my $line ($c->{line}, map { $_->[2] } @{$c->{around} || []}) {
    my @o; while ($line =~ /([A-Za-z0-9’']+)/g) { my $raw = $1; my $k = lc $raw; $k =~ s/'/’/g; $k =~ s/^’+|’+$//g; my $k2 = $k =~ s/’s$//r;
      next if $added{$k} || $added{$k2}; my $v = $G->{$k} // $G->{$k2}; next unless defined $v; push @o, "$raw=" . (ref $v ? enc($v, $C) : $v) }
    print "  | $line\n      ", join("\n      ", @o), "\n" if @o } }
}
