export function App() {
	return <Host slot={<button>{<X />}</button>} onChange={(d: any) => go(d)} />;
}