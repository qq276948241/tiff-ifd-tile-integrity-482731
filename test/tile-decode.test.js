"use strict";
// Tile decoding: chunky/planar tiles, edge tiles smaller than the tile grid,
// padding isolation, missing tiles, and tile/strip equivalence on identical pixels.
var test = require("node:test");
var H = require("./lib/helpers");
var UTIF = H.UTIF, Writer = H.Writer, assert = H.assert, expectTiffError = H.expectTiffError;

test("uncompressed tiles match hand-computed pixels and ignore edge padding", function() {
	// dimensions deliberately not a multiple of tile size -> partial edge tiles
	var w=7,h=5, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1,tileW:4,tileH:4});
	var ifd = H.decodeFirst(buff);
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px));
	H.assertRGBA(UTIF.toRGBA8(ifd), H.expectedGrayRGBA8(w,h), "tile gray8");
});

test("LZW and PackBits tiles reconstruct exactly", function() {
	var w=9,h=7, px=H.rgb8(w,h);
	[5, 32773].forEach(function(cmpr) {
		var buff = H.buildOne(w,h,px,{compression:cmpr,photometric:2,bps:8,spp:3,tileW:4,tileH:4});
		var ifd = H.decodeFirst(buff);
		assert.deepStrictEqual(Array.from(ifd.data), Array.from(px), "cmpr=" + cmpr);
	});
});

test("planar tiles (config 2) reassemble into chunky RGB", function() {
	var w=8,h=6, px=H.rgb8(w,h);
	var buff = H.buildOne(w,h,px,{compression:32773,photometric:2,bps:8,spp:3,planar:2,tileW:4,tileH:4});
	var ifd = H.decodeFirst(buff);
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px));
});

test("16-bit tiled grayscale preserves samples and applies fixed scaling", function() {
	var w=6,h=4, px=H.gray16(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1,bps:16,spp:1,tileW:4,tileH:4});
	var ifd = H.decodeFirst(buff);
	assert.deepStrictEqual(Array.from(ifd.data), Array.from(px));
	var rgba = UTIF.toRGBA8(ifd);
	var x=3,y=1,v=H.sample16(x,y,0),i=(y*w+x)*4;
	assert.strictEqual(rgba[i], H.scale16(v));
});

test("tile and strip encodings of the same pixels decode identically", function() {
	var w=10,h=8, px=H.rgb8(w,h);
	var stripBuff = H.buildOne(w,h,px,{compression:5,photometric:2,bps:8,spp:3,rps:4});
	var tileBuff  = H.buildOne(w,h,px,{compression:5,photometric:2,bps:8,spp:3,tileW:4,tileH:4});
	var a = H.decodeFirst(stripBuff), b = H.decodeFirst(tileBuff);
	assert.deepStrictEqual(Array.from(a.data), Array.from(b.data), "tile/strip pixel equivalence");
	assert.deepStrictEqual(Array.from(UTIF.toRGBA8(a)), Array.from(UTIF.toRGBA8(b)), "rgba equivalence");
});

test("missing tile (too few offsets) is rejected", function() {
	var w=8,h=8, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1,tileW:4,tileH:4});
	var ifds = UTIF.decode(buff);
	// 2x2 grid needs 4 tiles; truncate to 3
	ifds[0].t324 = ifds[0].t324.slice(0,3);
	ifds[0].t325 = ifds[0].t325.slice(0,3);
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "MISSING_TILE");
});

test("planar tile count mismatch across components is rejected", function() {
	var w=8,h=8, px=H.rgb8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:2,bps:8,spp:3,planar:2,tileW:4,tileH:4});
	var ifds = UTIF.decode(buff);
	// planar needs 3*4=12 tile chunks; drop to 11
	ifds[0].t324 = ifds[0].t324.slice(0,11);
	ifds[0].t325 = ifds[0].t325.slice(0,11);
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "MISSING_TILE");
});

test("edge tile content does not leak padding into the assembled image", function() {
	// If padding leaked, the assembled row length would exceed the real width.
	var w=5,h=3, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:32773,photometric:1,tileW:4,tileH:4});
	var ifd = H.decodeFirst(buff);
	assert.strictEqual(ifd.width, w);
	assert.strictEqual(ifd.height, h);
	assert.strictEqual(ifd.data.length, w*h);   // no padding carried into output
});

test("tile offset outside the file is rejected before expansion", function() {
	var w=8,h=8, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1,tileW:4,tileH:4});
	var u8len = new Uint8Array(buff).length;
	var ifds = UTIF.decode(buff);
	ifds[0].t324 = [u8len + 200];
	ifds[0].t325 = [10];
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "CHUNK_OUT_OF_BOUNDS");
});
