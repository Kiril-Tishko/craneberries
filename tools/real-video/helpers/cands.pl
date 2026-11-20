use strict; use warnings;
use JSON::PP;
# perl cands.pl <words dir> "slug=query" "slug=query" … [--n 6]
# For each word: searches the private caption index for the query and prints the matches whose video the word
# doesn't use yet, as: id start-end | channel | before / >> line / after (one line each, short).
my $dir = shift; my $n = 6; my @q;
while (@ARGV) { my $a = shift; if ($a eq '--n') { $n = shift } else { push @q, $a } }
my $S = 'tools/real-video/index/search.pl';
for my $p (@q) {
  my ($slug, $query) = split /=/, $p, 2;
  my %used;
  if (open my $fh, '<:raw', "$dir/$slug.json") { local $/; my $w = JSON::PP->new->utf8->decode(<$fh>); $used{$_->{v}} = 1 for @{$w->{clips} || []} }
  my $out = `perl $S "$query" 25 2>/dev/null`;
  print "=== $slug ($query)\n"; my $k = 0;
  for my $b (split /\n(?=\d+\. )/, $out) {
    my ($ch) = $b =~ /^\d+\. (.*?) ·/ or next;
    my ($id, $s, $e) = $b =~ /\(([\w-]{11}), ([\d.]+)-([\d.]+)/ or next;
    next if $used{$id};
    my @l = map { s/^\s*(?:>>)?\s*[\d:]+\s+//r } grep { /^\s+(>>)?\s+[\d:]+\s/ } split /\n/, $b;
    my ($mi) = grep { $b =~ /^\s*>>/m } 0; my @lines = split /\n/, $b;
    my ($before, $line, $after) = ('', '', '');
    my @tl = grep { /^\s+(>>)?\s+\d+:\d+/ } @lines;
    for my $i (0 .. $#tl) { if ($tl[$i] =~ /^\s*>>/) { $line = $tl[$i]; $before = $i ? $tl[$i - 1] : ''; $after = $tl[$i + 1] // ''; last } }
    s/^\s*(>>)?\s*[\d:]+\s+// for $before, $line, $after;
    printf "  %s %s-%s | %s | %s / >> %s / %s\n", $id, $s, $e, substr($ch, 0, 22), substr($before, 0, 60), substr($line, 0, 90), substr($after, 0, 60);
    last if ++$k >= $n;
  }
}
