export function App() {
	return <Host prop={((c: any) => (<Col a={c.a}>{c.name}</Col>)) as any} />;
}