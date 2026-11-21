# UTIF.js offline test suite

Runs entirely under Node with no network access and no binary fixtures checked
into the repo. Every TIFF used by the tests is generated from scratch by an
independent writer, and expected pixels are computed by explicit formulas
rather than read back through the decoder.

## Run

```sh
npm test
# or directly
node --test test/*.test.js
```

## Layout

- `lib/tiff-writer.js` — self-contained TIFF writer (LE/BE, strips and tiles,
  chunky/planar, uncompressed / PackBits / LZW, horizontal predictor). It shares
  no code with `UTIF.js`, so the decoder cannot be validated against its own
  assumptions.
- `lib/packbits-encode.js` / `lib/lzw-encode.js` — independent compressors used
  only to build fixtures.
- `lib/helpers.js` — deterministic hand-computed sample generators, literal
  anchor expectations and shared assertions.
- `ifd-boundary.test.js` — byte order, magic, chained/circular IFDs, out-of-range
  and truncated offsets, unknown tag types, page-private tags, EXIF-only IFDs.
- `strip-decode.test.js` — chunky/planar strips, 8/16-bit gray and RGB, PackBits,
  LZW (single and multi strip), predictor reversal, strip-count and range checks,
  idempotent repeat decoding.
- `tile-decode.test.js` — tiles incl. partial edge tiles, padding isolation,
  missing tiles, planar tiles, tile/strip equivalence.
- `color-and-pages.test.js` — fixed 16->8 scaling, palette/alpha, orientation
  1..8, corrupt-page isolation, metadata retention, over-budget rejection.
- `validation-hardening.test.js` — integer overflow, unknown compression,
  malformed LZW/PackBits streams, sub-IFD cycles, bad dimensions/predictor.
- `compression.test.js` — LZW dictionary width transitions (9..12 bits), the
  KwKw edge case, saturation/empty inputs and PackBits round-trips, plus
  output-region overflow guards.

All malformed-input failures are asserted against stable `UTIF.TiffError` codes,
not merely "the function did not throw".
