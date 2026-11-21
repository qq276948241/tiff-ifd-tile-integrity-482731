"use strict";
// Color output (scaling, palette, alpha, orientation), multi-page isolation,
// over-budget rejection, idempotent repeat decoding and metadata retention.
var test = require("node:test");
var H = require("./lib/helpers");
var UTIF = H.UTIF, Writer = H.Writer, assert = H.assert, expectTiffError = H.expectTiffError;

test("8-bit palette image maps indices through the ColorMap", function() {
	var w=3,h=2;
	var idx = new Uint8Array([0,1,2,3,1,0]);
	// TIFF ColorMap: 2^bps entries per channel, laid out R[], then G[], then B[].
	var cn = 256, map = new Uint16Array(cn*3);
	var palette = [[65535,0,0],[0,65535,0],[0,0,65535],[255,255,255]];
	for(var e=0;e<4;e++){ map[e]=palette[e][0]; map[cn+e]=palette[e][1]; map[2*cn+e]=palette[e][2]; }
	var buff = new Writer(true).addPage(w,h,idx,{
		photometric:3,bps:8,spp:1,
		extraTags:[{tag:320,type:3,value:Array.from(map)}]
	}).build();
	var ifd = H.decodeFirst(buff);
	var rgba = UTIF.toRGBA8(ifd);
	// ColorMap 16-bit entries are taken as high byte (>>8), as fixed by the decoder
	function hi(v){return (v>>8)&255;}
	for(var p=0;p<w*h;p++){
		var c = palette[idx[p]];
		assert.strictEqual(rgba[p*4],   hi(c[0]), "R idx " + idx[p]);
		assert.strictEqual(rgba[p*4+1], hi(c[1]), "G");
		assert.strictEqual(rgba[p*4+2], hi(c[2]), "B");
		assert.strictEqual(rgba[p*4+3], 255, "A");
	}
});

test("palette image without a ColorMap fails with a stable error", function() {
	var w=2,h=2, idx=new Uint8Array([0,1,1,0]);
	var buff = new Writer(true).addPage(w,h,idx,{photometric:3,bps:8,spp:1}).build();
	var ifd = H.decodeFirst(buff);
	expectTiffError(function(){ UTIF.toRGBA8(ifd); }, "MISSING_COLORMAP");
});

test("orientation 1..8 maps pixels by the fixed rules", function() {
	// 2x2 distinct grayscale values. Source grid (x,y):
	//   (0,0)=10  (1,0)=20
	//   (0,1)=30  (1,1)=40
	var w=2,h=2, px=new Uint8Array([10,20,30,40]);
	// Independent expectation: for each orientation, the output grid in
	// row-major order. Derived directly from the TIFF spec transforms rather
	// than from the decoder.
	var grids = {
		1:[10,20,30,40],                 // identity
		2:[20,10,40,30],                 // flip horizontal
		3:[40,30,20,10],                 // rotate 180
		4:[30,40,10,20],                 // flip vertical
		5:[10,30,20,40],                 // transpose (output 2x2)
		6:[30,10,40,20],                 // rotate 90 CW
		7:[40,20,30,10],                 // transverse
		8:[20,40,10,30]                  // rotate 270 CW
	};
	Object.keys(grids).forEach(function(oriStr) {
		var ori = Number(oriStr);
		var buff = new Writer(true).addPage(w,h,px,{photometric:1,orientation:ori}).build();
		var ifd = H.decodeFirst(buff);
		var rgba = UTIF.toRGBA8(ifd);
		var swap = ori>=5, ow = swap?h:w, oh = swap?w:h;
		assert.strictEqual(rgba.length, ow*oh*4, "ori " + ori + " dims");
		var got = [];
		for(var q=0;q<ow*oh;q++) got.push(rgba[q*4]);
		assert.deepStrictEqual(got, grids[oriStr], "ori " + ori + " pixel order");
	});
});

test("invalid orientation is rejected", function() {
	var w=2,h=2, px=new Uint8Array([1,2,3,4]);
	var buff = new Writer(true).addPage(w,h,px,{photometric:1,orientation:9}).build();
	var ifd = H.decodeFirst(buff);
	expectTiffError(function(){ UTIF.toRGBA8(ifd); }, "BAD_ORIENTATION");
});

test("a corrupt page does not prevent decoding later pages", function() {
	var w=4,h=4;
	var p1=H.gray8(w,h), p2=H.gray8(w,h), p3=H.gray8(w,h);
	var buff = new Writer(true)
		.addPage(w,h,p1,{photometric:1})
		.addPage(w,h,p2,{photometric:1})
		.addPage(w,h,p3,{photometric:1}).build();
	var ifds = UTIF.decode(buff);
	// corrupt page 2's data offset; pages 1 and 3 must still decode
	ifds[1].t273 = [new Uint8Array(buff).length + 10];
	H.assertRGBA(UTIF.toRGBA8(decodePage(buff,ifds[0])),
		H.expectedGrayRGBA8(w,h), "page1 intact");
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[1]); }, "CHUNK_OUT_OF_BOUNDS");
	// page 2 left no pixel state and page 3 still works
	assert.strictEqual(ifds[1].data, undefined);
	var page3 = decodePage(buff, ifds[2]);
	H.assertRGBA(UTIF.toRGBA8(page3), H.expectedGrayRGBA8(w,h), "page3 intact");
});

test("metadata and page-private tags survive a full decode cycle", function() {
	var w=3,h=3, px=H.gray8(w,h);
	var buff = new Writer(true).addPage(w,h,px,{
		photometric:1,
		extraTags:[
			{tag:305,type:2,value:["TestScanner"]},
			{tag:700,type:3,value:[42,43,44]}
		]
	}).build();
	var ifd = H.decodeFirst(buff);
	assert.strictEqual(ifd.t305[0], "TestScanner");
	assert.deepStrictEqual(Array.from(ifd.t700), [42,43,44]);
	// raw high data still present after toRGBA8
	var before = Array.from(ifd.data);
	UTIF.toRGBA8(ifd);
	assert.deepStrictEqual(Array.from(ifd.data), before, "data untouched by toRGBA8");
});

test("an image over the pixel budget is rejected before allocation", function() {
	var w=100,h=100, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1});
	var ifds = UTIF.decode(buff);
	expectTiffError(function(){
		UTIF.decodeImage(buff, ifds[0], ifds, { maxBytes: 1000 });
	}, "IMAGE_TOO_LARGE");
	assert.strictEqual(ifds[0].data, undefined, "no state after budget rejection");
});

test("decompression size mismatch (declared count too small) is rejected", function() {
	var w=4,h=4, px=H.gray8(w,h);
	var buff = H.buildOne(w,h,px,{compression:1,photometric:1});
	var ifds = UTIF.decode(buff);
	// claim fewer bytes than the strip actually needs
	ifds[0].t279 = [ifds[0].t279[0] - 4];
	expectTiffError(function(){ UTIF.decodeImage(buff, ifds[0]); }, "DECOMPRESS_SIZE");
});

function decodePage(buff, ifd) { UTIF.decodeImage(buff, ifd); return ifd; }
