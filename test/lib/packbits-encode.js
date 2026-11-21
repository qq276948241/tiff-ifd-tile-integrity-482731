"use strict";
// Independent PackBits encoder (Apple / TIFF spec), written only for building
// test fixtures. It does not share any code with the decoder under test.
function encodePackBits(input) {
	var out = [];
	var i = 0;
	while(i < input.length) {
		// measure a repeat run (>=2 equal bytes)
		var run = 1;
		while(i + run < input.length && run < 128 && input[i + run] === input[i]) run++;
		if(run >= 2) {
			out.push(-(run - 1) & 0xff, input[i]);
			i += run;
			continue;
		}
		// gather a literal run until the next repeat or the 128-byte limit
		var start = i;
		while(i < input.length) {
			if(i + 1 < input.length && input[i] === input[i + 1]) break;
			if(i - start >= 127) { i++; break; }
			i++;
		}
		var lit = i - start;
		out.push(lit - 1);
		for(var k = 0; k < lit; k++) out.push(input[start + k]);
	}
	return new Uint8Array(out);
}

module.exports = { encodePackBits };
