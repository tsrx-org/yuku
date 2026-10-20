export async function App() @{
	let a;
	for await (a as string of ['x']) {}
	<div>{a}</div>
}