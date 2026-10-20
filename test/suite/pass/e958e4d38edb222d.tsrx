interface I {
	m({ a }?: { a: number }): void;
	([a]?: number[]): void;
	new ({ a }?: { a: number }): I;
}