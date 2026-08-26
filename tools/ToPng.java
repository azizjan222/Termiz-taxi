import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * Convert any ImageIO-readable image (JPEG, PNG, GIF, BMP, WEBP where supported) into a
 * plain 8-bit RGBA PNG, so the pure-Python icon generator only ever has to handle PNG.
 *
 * Usage: java ToPng.java <input> <output.png>
 */
public class ToPng {
  public static void main(String[] args) throws Exception {
    if (args.length != 2) {
      System.err.println("usage: java ToPng.java <input> <output.png>");
      System.exit(2);
    }
    BufferedImage in = ImageIO.read(new File(args[0]));
    if (in == null) {
      System.err.println("ImageIO could not decode: " + args[0]);
      System.exit(1);
    }
    // Redraw into TYPE_INT_ARGB so the output is always straightforward RGBA, whatever
    // colour model (CMYK JPEG, palette GIF, ...) the source used.
    BufferedImage out = new BufferedImage(in.getWidth(), in.getHeight(), BufferedImage.TYPE_INT_ARGB);
    var g = out.createGraphics();
    g.drawImage(in, 0, 0, null);
    g.dispose();
    if (!ImageIO.write(out, "png", new File(args[1]))) {
      System.err.println("no PNG writer available");
      System.exit(1);
    }
    System.out.printf("%s -> %s  %dx%d%n", args[0], args[1], out.getWidth(), out.getHeight());
  }
}
