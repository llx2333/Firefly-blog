import assert from "node:assert/strict";
import test from "node:test";
import { computeIndentGuides, guideLineStyle } from "./indent-guides";

test("guides follow ancestor columns, including closing lines", () => {
	assert.deepEqual(
		computeIndentGuides(["[", "    {", "        key", "    }", "]"]),
		[[], [0], [0, 4], [0], []],
	);
});

test("irregular indentation does not invent fixed-grid levels", () => {
	assert.deepEqual(
		computeIndentGuides(["  root", "     child", "       key", "     sibling"]),
		[[], [2], [2, 5], [2]],
	);
});

test("blank lines keep only scopes that continue after them", () => {
	assert.deepEqual(
		computeIndentGuides(["root", "  child", "", "  sibling", "", "root", ""]),
		[[], [0], [0], [0], [], [], []],
	);
	assert.deepEqual(computeIndentGuides(["root", "", "  child", ""]), [
		[],
		[0],
		[0],
		[],
	]);
});

test("tabs advance to column stops", () => {
	assert.deepEqual(computeIndentGuides(["root", " \tchild", " \t\tkey"]), [
		[],
		[0],
		[0, 4],
	]);
	assert.deepEqual(computeIndentGuides(["root", "\tchild", "\t\tkey"], 2), [
		[],
		[0],
		[0, 2],
	]);
});

test("empty and unindented blocks have no guides", () => {
	assert.deepEqual(computeIndentGuides([]), []);
	assert.deepEqual(computeIndentGuides(["", "   ", "root", "next"]), [
		[],
		[],
		[],
		[],
	]);
});

test("line paint uses columns rather than accumulated line heights", () => {
	assert.equal(guideLineStyle([]), "--igi:none;--igx:0 0");
	assert.equal(
		guideLineStyle([0, 5]),
		"--igi:var(--ig),var(--ig);--igx:calc(0.5ch + var(--ig-offset, 0px) - 0.5px) 0,calc(5.5ch + var(--ig-offset, 0px) - 0.5px) 0",
	);
});
