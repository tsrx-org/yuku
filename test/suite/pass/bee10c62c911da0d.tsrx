export function App() {
	return <Host prop={fn((c: any) => (<Col id={c.id} />)) as any} />;
}