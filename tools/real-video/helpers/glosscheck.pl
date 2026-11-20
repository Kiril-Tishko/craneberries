#!/usr/bin/env perl
# Every word under a clip must be tappable: this says which words of each clip's line and lines around have no gloss
# (as the player taps them: the yellow word and `together` phrases are taken whole), and whether hl matches each line.
#   perl tools/real-video/helpers/glosscheck.pl docs/real-video/words/a.json …   (exit 1 when a gloss is missing)
use strict; use warnings; use utf8;
use JSON::PP;
binmode STDOUT, ':encoding(UTF-8)';
my $bad = 0;
for my $f (@ARGV) {
  open my $fh, '<:raw', $f or die "$f: $!"; local $/; my $raw = <$fh>; close $fh;
  my $w = eval { JSON::PP->new->utf8->decode($raw) } or do { print "$f: BAD JSON $@\n"; $bad++; next };
  my $hl = $w->{hl} // quotemeta($w->{en} // '');
  my $re = eval { qr/$hl/i } or do { print "$f: bad hl\n"; $bad++; next };
  my %G = %{$w->{gloss} // {}};
  my @tog = grep { ($w->{together}{$_} // '') ne '' } keys %{$w->{together} // {}};
  my @miss;
  for my $c (@{$w->{clips} // []}) {
    unless ($c->{line} =~ $re) { print "$f: hl doesn't match: $c->{line}\n"; $bad++ }
    for my $t ($c->{line}, map { $_->[2] } @{$c->{around} // []}) {
      my @cov = (0) x length $t;
      while ($t =~ /$re/g) { @cov[$-[0] .. $+[0] - 1] = (1) x ($+[0] - $-[0]) if $+[0] > $-[0] }
      for my $p (@tog) {
        (my $pat = quotemeta $p) =~ s/(?:\\’|\\')/[’']/g; $pat =~ s/\\\s+/\\s+/g;
        while ($t =~ /(?:^|(?<=[^\w’']))($pat)(?![\w’'])/gi) {
          next if grep { $_ } @cov[$-[1] .. $+[1] - 1];
          @cov[$-[1] .. $+[1] - 1] = (2) x ($+[1] - $-[1]);
        }
      }
      while ($t =~ /([A-Za-z0-9’']+)/g) {
        next if $cov[$-[1]];
        my $k = lc $1; $k =~ s/'/’/g; $k =~ s/^’+|’+$//g;
        next if $k eq '';
        $k =~ s/’s$// if !exists $G{$k} && exists $G{$k =~ s/’s$//r};
        push @miss, $k unless exists $G{$k};
      }
    }
  }
  my %seen; @miss = grep { !$seen{$_}++ } @miss;
  if (@miss) { print "$f: missing gloss: @miss\n"; $bad++ } else { print "$f: ok (" . scalar(@{$w->{clips}}) . " clips)\n" }
}
exit($bad ? 1 : 0);
