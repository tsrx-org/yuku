export function read() {
	try { throw 1; }
	catch (error) { var error = 2; return error; }
}