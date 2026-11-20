#!/usr/bin/env perl
# Look at clips without playing them (no sound, no player): YouTube's storyboard, the small pictures the timeline shows
# on hover, one every 2-10 s.
#   perl tools/real-video/helpers/frames.pl <out.png> <id>:<seconds> <id>:<seconds> …
# Saves one sheet, 3 pictures a row, each numbered in yellow in the order given, and prints its path; open it to check
# each clip's picture (a face, not a back; no burned-in subtitles). The frame is the one nearest before the time.
# Windows only (the cropping uses PowerShell's System.Drawing). Frames are kept in <out.png's folder>/frames/.
use strict; use warnings;
use File::Basename qw(dirname);
my $out = shift or die "usage: frames.pl <out.png> id:seconds …\n";
my $dir = dirname($out) . '/frames'; mkdir $dir;
my @png;
for my $p (@ARGV) {
  my ($v, $t) = $p =~ /^([\w-]{11}):(\d+(?:\.\d+)?)$/ or do { warn "bad $p\n"; push @png, ''; next };
  my $html = `curl -s -H "Accept-Language: en" "https://www.youtube.com/watch?v=$v"`;
  my ($spec) = $html =~ /"playerStoryboardSpecRenderer":\{"spec":"([^"]+)"/;
  unless ($spec) { warn "$v: no storyboard\n"; push @png, ''; next }
  $spec =~ s/\\u0026/&/g;
  my ($dur) = $html =~ /"lengthSeconds":"(\d+)"/;
  my @lv = split /\|/, $spec; my $base = shift @lv; my $L = $#lv;
  my ($w, $h, $count, $cols, $rows, $iv, $name, $sigh) = split /#/, $lv[$L];
  $iv ||= ($dur || 1) * 1000 / $count;
  my $idx = int($t * 1000 / $iv); $idx = $count - 1 if $idx >= $count;
  my $per = $cols * $rows; my $sheet = int($idx / $per); my $cell = $idx % $per;
  (my $n = $name) =~ s/\$M/$sheet/;
  (my $url = $base) =~ s/\$L/$L/; $url =~ s/\$N/$n/; $url .= "&sigh=$sigh";
  my $sp = "$dir/$v-$L-$sheet.jpg"; system('curl', '-s', '-o', $sp, $url) unless -s $sp;
  my $crop = "$dir/$v-" . int($t) . ".png";
  my ($cx, $cy) = (($cell % $cols) * $w, int($cell / $cols) * $h);
  ps("\$i=[System.Drawing.Image]::FromFile('$sp'); \$b=New-Object System.Drawing.Bitmap $w,$h; \$g=[System.Drawing.Graphics]::FromImage(\$b); "
   . "\$g.DrawImage(\$i,(New-Object System.Drawing.Rectangle 0,0,$w,$h),(New-Object System.Drawing.Rectangle $cx,$cy,$w,$h),[System.Drawing.GraphicsUnit]::Pixel); "
   . "\$b.Save('$crop'); \$g.Dispose(); \$i.Dispose()");
  push @png, $crop;
}
my $rows = int((@png + 2) / 3);
my $list = join(',', map { "'$_'" } @png);
ps("\$f=\@($list); \$b=New-Object System.Drawing.Bitmap 960," . (180 * $rows) . "; \$g=[System.Drawing.Graphics]::FromImage(\$b); "
 . "\$font=New-Object System.Drawing.Font('Arial',20,[System.Drawing.FontStyle]::Bold); "
 . "for(\$i=0;\$i -lt \$f.Count;\$i++){ \$x=(\$i%3)*320; \$y=[math]::Floor(\$i/3)*180; "
 . "if(\$f[\$i] -and (Test-Path \$f[\$i])){ \$im=[System.Drawing.Image]::FromFile(\$f[\$i]); \$g.DrawImage(\$im,\$x,\$y,320,180); \$im.Dispose() }; "
 . "\$g.FillRectangle([System.Drawing.Brushes]::Black,\$x,\$y,34,30); \$g.DrawString([string](\$i+1),\$font,[System.Drawing.Brushes]::Yellow,\$x+2,\$y+1) }; "
 . "\$b.Save('$out'); \$g.Dispose()");
print "$out\n";
sub ps { system('powershell', '-NoProfile', '-Command', 'Add-Type -AssemblyName System.Drawing; ' . shift) }
