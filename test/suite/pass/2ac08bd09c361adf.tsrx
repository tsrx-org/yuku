export function App() {
	return <Host prop={((c: any) => (<Col id={c.id} />)) as any} />;
}