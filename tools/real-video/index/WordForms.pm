package WordForms;
# "Any forms" for the caption index search (search.pl --forms, the page's "Any forms" switch; his wish, Nov 24: "if I
# press any forms then it should be any forms"): shake = shakes, shook, shaken, shaking; hand = hands; child =
# children; didn't = did not = didnt. Words are tokens as the index sees them (CaptionIndex::tokens: lower case, no
# accents, an apostrophe splits a word: "didn't" is "didn" "t"). These rules guess generously (shake -> "shaked");
# search.pl keeps only the forms that really occur in the index.
use strict; use warnings; use utf8;
use Exporter 'import';
our @EXPORT_OK = qw(word_forms phrase_variants little_word);

# Irregular verbs: base, past, past participle ("/" = either). The -s and -ing forms follow the usual rules.
my @IRREGULAR = map { [map { [split m{/}] } split / /] } split /\n/, <<'V';
arise arose arisen
awake awoke awoken
be was/were been
bear bore borne/born
beat beat beaten
become became become
begin began begun
bend bent bent
bet bet bet
bind bound bound
bite bit bitten
bleed bled bled
blow blew blown
break broke broken
breed bred bred
bring brought brought
broadcast broadcast broadcast
build built built
burn burnt/burned burnt/burned
burst burst burst
buy bought bought
cast cast cast
catch caught caught
choose chose chosen
cling clung clung
come came come
cost cost cost
creep crept crept
cut cut cut
deal dealt dealt
dig dug dug
dive dove/dived dived
do did done
draw drew drawn
dream dreamt/dreamed dreamt/dreamed
drink drank drunk
drive drove driven
eat ate eaten
fall fell fallen
feed fed fed
feel felt felt
fight fought fought
find found found
flee fled fled
fling flung flung
fly flew flown
forbid forbade forbidden
forecast forecast forecast
foresee foresaw foreseen
forget forgot forgotten
forgive forgave forgiven
freeze froze frozen
get got got/gotten
give gave given
go went gone
grind ground ground
grow grew grown
hang hung/hanged hung/hanged
have had had
hear heard heard
hide hid hidden
hit hit hit
hold held held
hurt hurt hurt
keep kept kept
kneel knelt/kneeled knelt/kneeled
know knew known
lay laid laid
lead led led
lean leaned/leant leaned/leant
leap leaped/leapt leaped/leapt
learn learned/learnt learned/learnt
leave left left
lend lent lent
let let let
lie lay/lied lain/lied
light lit/lighted lit/lighted
lose lost lost
make made made
mean meant meant
meet met met
mislead misled misled
mistake mistook mistaken
misunderstand misunderstood misunderstood
overcome overcame overcome
overdo overdid overdone
overhear overheard overheard
oversleep overslept overslept
overthink overthought overthought
pay paid paid
prove proved proved/proven
put put put
quit quit quit
read read read
redo redid redone
rethink rethought rethought
rewrite rewrote rewritten
rid rid rid
ride rode ridden
ring rang rung
rise rose risen
run ran run
say said said
see saw seen
seek sought sought
sell sold sold
send sent sent
set set set
sew sewed sewn/sewed
shake shook shaken
shine shone/shined shone/shined
shoot shot shot
show showed shown/showed
shrink shrank shrunk
shut shut shut
sing sang sung
sink sank sunk
sit sat sat
sleep slept slept
slide slid slid
smell smelled/smelt smelled/smelt
speak spoke spoken
speed sped/speeded sped/speeded
spell spelled/spelt spelled/spelt
spend spent spent
spill spilled/spilt spilled/spilt
spin spun spun
spit spat/spit spat/spit
split split split
spoil spoiled/spoilt spoiled/spoilt
spread spread spread
spring sprang sprung
stand stood stood
steal stole stolen
stick stuck stuck
sting stung stung
stink stank stunk
strike struck struck
string strung strung
swear swore sworn
sweep swept swept
swell swelled swollen/swelled
swim swam swum
swing swung swung
take took taken
teach taught taught
tear tore torn
tell told told
think thought thought
throw threw thrown
undergo underwent undergone
understand understood understood
undertake undertook undertaken
undo undid undone
upset upset upset
wake woke woken
wear wore worn
weave wove woven
weep wept wept
win won won
wind wound wound
withdraw withdrew withdrawn
withhold withheld withheld
write wrote written
V
# Forms that don't follow the rules for -s / -ing.
my %EXTRA = (be => [qw(am is are being)], have => [qw(has having)], do => [qw(does doing)], go => [qw(goes going)],
  say => [qw(says saying)], lie => [qw(lying lies)], die => [qw(dying dies)], tie => [qw(tying ties)]);
my @NOUNS = map { [split / /] } split /\n/, <<'N';
man men
woman women
child children
person people
foot feet
tooth teeth
mouse mice
goose geese
life lives
wife wives
knife knives
leaf leaves
half halves
wolf wolves
shelf shelves
thief thieves
loaf loaves
calf calves
N
# Words that only look like a form of another word (evening is not "even" + ing, news is not "new" + s).
my %NOT_A_FORM = map { $_ => 1 } qw(evening news wicked wedding during nothing something anything everything
  ceiling morning darling pudding sibling always perhaps series species means business glasses);

my (%base_of, %forms_of_base);   # irregular and noun tables, both ways
for my $v (@IRREGULAR) {
  my ($base) = @{$v->[0]};
  my @f = map { @$_ } @$v;
  push @f, @{$EXTRA{$base} || []};
  $forms_of_base{$base} = [@f];
  push @{$base_of{$_}}, $base for @f;
}
for my $b (keys %EXTRA) { next if $forms_of_base{$b}; $forms_of_base{$b} = [$b, @{$EXTRA{$b}}]; push @{$base_of{$_}}, $b for @{$forms_of_base{$b}} }
for my $n (@NOUNS) { my ($s, $p) = @$n; $forms_of_base{$s} = [$s, $p]; push @{$base_of{$_}}, $s for $s, $p }

# The usual -s, -ed and -ing forms of a base (generous: "visit" gives visited and visitted; only real ones are kept).
sub regular {
  my $b = shift;
  my @f = ($b);
  if ($b =~ /(?:s|x|z|ch|sh)$/) { push @f, "${b}es" }
  elsif ($b =~ /^(.*[^aeiou])y$/) { push @f, "$1ies" }
  elsif ($b =~ /[^aeiou]o$/) { push @f, "${b}es", "${b}s" }
  else { push @f, "${b}s" }
  my $double = $b =~ /[^aeiou][aeiou]([bdfgklmnprtvz])$/ ? $1 : '';
  if ($b =~ /e$/) { push @f, "${b}d" }
  elsif ($b =~ /^(.*[^aeiou])y$/) { push @f, "$1ied" }
  else { push @f, "${b}ed"; push @f, "$b${double}ed" if $double }
  if ($b =~ /^(.*)ie$/) { push @f, "$1ying" }
  elsif ($b =~ /^(.*[^aeoy])e$/) { push @f, "$1ing" }
  else { push @f, "${b}ing"; push @f, "$b${double}ing" if $double }
  @f;
}

# Little words keep their one form (the, you, and the bits of a contraction: didn't = "didn" "t").
my %ONE_FORM = map { $_ => 1 } qw(a an the i you he she it we they me him her us them my your his its our their
  to of in on at by for from with and or but not no so if as than then that this these those what who whom whose
  how why when where there here t s m re ll ve d o y ok okay oh yes yeah);

my %NOUN = map { $_->[0] => 1 } @NOUNS;

# Words between the searched words are allowed only between two words that carry meaning ("shake his hand"), never
# next to a little word ("I am going to" stays together; else every line with I and to would match).
my %LITTLE = (%ONE_FORM, map { $_ => 1 } qw(am is are was were be been being do does did done doing have has had
  having will would can could shall should may might must going gonna wanna gotta get got just really very not));
sub little_word { $LITTLE{$_[0]} || length $_[0] < 2 }

# Bases a word may come from: the tables (shook -> shake, children -> child), else itself and the rules backwards
# (shaking -> shake, tries -> try, stopping -> stop). With $have (word => how many caption lines have it), a base the
# rules guessed must be a real word there: in at least 10 lines, and not rare next to the other guesses (the
# captions' own slips, like "shak", don't count).
sub bases {
  my ($w, $have) = @_;
  return @{$base_of{$w}} if $base_of{$w};
  return ($w) if $NOT_A_FORM{$w};
  my @c;
  if ($w =~ /^(.+)ies$/) { push @c, "$1y" }
  if ($w =~ /^(.+)es$/) { push @c, $1 }
  if ($w =~ /^(.+[^su])s$/) { push @c, $1 }
  if ($w =~ /^(.+)ied$/) { push @c, "$1y" }
  if ($w =~ /^(.+)ed$/) { my $s = $1; push @c, $s, "${s}e"; push @c, "$1$2" if $s =~ /^(.+)(.)\2$/ && $2 !~ /[lsz]/ }
  if ($w =~ /^(.+)ying$/) { push @c, "$1ie" }
  if ($w =~ /^(.+)ing$/) { my $s = $1; push @c, $s, "${s}e"; push @c, "$1$2" if $s =~ /^(.+)(.)\2$/ && $2 !~ /[lsz]/ }
  @c = grep { length >= 3 } @c;
  if ($have) {
    my $top = 0; for (@c) { $top = $have->{$_} if ($have->{$_} // 0) > $top }
    @c = grep { $forms_of_base{$_} || (($have->{$_} // 0) >= 10 && $have->{$_} >= $top / 10) } @c;
  }
  my %b = ($w => 1);
  for (@c) { $b{$_} = 1 for $base_of{$_} ? @{$base_of{$_}} : $_ }
  keys %b;
}

# Every form a word might have (the word itself first). Without $have it guesses generously (to ask the index which
# of them it has); with $have (word => how many caption lines have it) only the ones in at least 3 lines.
sub word_forms {
  my ($w, $have) = @_;
  return ($w) if $ONE_FORM{$w} || length $w < 2 || $w =~ /^\d+$/;
  my %f = ($w => 1);
  for my $b (bases($w, $have)) {
    my @tab = @{$forms_of_base{$b} || []};
    # A noun's plural and a verb's -s / -ing with irregular forms are in the tables; an irregular verb's -ed form
    # ("shaked") is a mistake, its -s and -ing forms are regular.
    my @reg = $NOUN{$b} || $EXTRA{$b} ? ($b) : @tab ? grep { !/ed$/ || $_ eq $b } regular($b) : regular($b);
    $f{$_} = 1 for @tab, @reg;
  }
  ($w, grep { $_ ne $w && (!$have || ($have->{$_} // 0) >= 3) } sort keys %f);
}

# ---- phrases: didn't = did not = didnt ----

# Groups of token sequences that say the same thing.
my @SAME;
for my $x (qw(do does did is are was were has have had could would should must need might)) {
  push @SAME, [[$x, 'not'], ["${x}n", 't'], ["${x}nt"]];
}
push @SAME, [['can', 'not'], ['cannot'], ['can', 't'], ['cant']], [['will', 'not'], ['won', 't'], ['wont']],
  [['shall', 'not'], ['shan', 't']], [['ain', 't'], ['aint']];
for my $p (qw(i)) { push @SAME, [[$p, 'am'], [$p, 'm'], ["${p}m"]] }
for my $p (qw(you we they who what there)) { push @SAME, [[$p, 'are'], [$p, 're'], ($p =~ /^(you|they)$/ ? ["${p}re"] : ())] }
for my $p (qw(it that he she what there here who where how)) { push @SAME, [[$p, 'is'], [$p, 's']] }
for my $p (qw(i you we they he she it that there who)) {
  push @SAME, [[$p, 'will'], [$p, 'll']], [[$p, 'would'], [$p, 'd']], [[$p, 'had'], [$p, 'd']];
}
for my $p (qw(i you we they would could should might must)) { push @SAME, [[$p, 'have'], [$p, 've']] }
push @SAME, [['let', 'us'], ['let', 's'], ['lets']], [['going', 'to'], ['gonna']], [['want', 'to'], ['wanna']],
  [['got', 'to'], ['gotta']], [['kind', 'of'], ['kinda']], [['sort', 'of'], ['sorta']], [['out', 'of'], ['outta']],
  [['give', 'me'], ['gimme']], [['let', 'me'], ['lemme']], [['do', 'not', 'know'], ['dunno']],
  [['okay'], ['ok']], [['alright'], ['all', 'right']];

# The phrase (a list of tokens) and the ways of saying it with the groups above: [[tokens, changed?], …], the phrase
# as typed first. At most 24.
sub phrase_variants {
  my @out = ([[@{$_[0]}], 0]);
  my %seen = (join(' ', @{$_[0]}) => 1);
  for (my $k = 0; $k < @out && @out < 24; $k++) {
    my @t = @{$out[$k][0]};
    for my $g (@SAME) {
      for my $from (@$g) {
        my $n = @$from;
        for my $i (0 .. @t - $n) {
          next if grep { $t[$i + $_] ne $from->[$_] } 0 .. $n - 1;
          for my $to (@$g) {
            next if $to == $from;
            my @v = (@t[0 .. $i - 1], @$to, @t[$i + $n .. $#t]);
            next if $seen{join ' ', @v}++;
            push @out, [\@v, 1];
          }
        }
      }
    }
  }
  @out[0 .. ($#out < 23 ? $#out : 23)];
}

1;
