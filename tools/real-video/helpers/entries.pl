use strict; use warnings;
# perl entries.pl "query|id|start" … → for each: the ready clip entry plus the two lines before and after (short).
my $S = 'tools/real-video/index/search.pl';
my %cache;
for my $p (@ARGV) {
  my ($q, $id, $st) = split /\|/, $p;
  $cache{$q} //= `perl $S "$q" 40 --clip 2>/dev/null`;
  my $hit;
  for my $b (split /\n(?=\d+\. )/, $cache{$q}) { next unless $b =~ /\(\Q$id\E, \Q$st\E/; $hit = $b; last }
  unless ($hit) { for my $b (split /\n(?=\d+\. )/, $cache{$q}) { next unless $b =~ /\(\Q$id\E, (\d+)/ && abs($1 - int $st) <= 2; $hit = $b; last } }
  unless ($hit) { print "?? $p not found\n"; next }
  my ($ch) = $hit =~ /^\d+\. (.*?) ·/;
  my @t = grep { /^\s+(>>)?\s+[\d:]+\s/ } split /\n/, $hit;
  s/^\s+(>>)?\s+[\d:]+\s+/$1 ? '>> ' : '   '/e for @t;
  my ($clip) = $hit =~ /clip: (\{.*\})/;
  print "## $ch\n", join("\n", map { "  " . substr($_, 0, 150) } @t), "\n  $clip\n";
}
