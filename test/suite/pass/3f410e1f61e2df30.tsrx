export function App() @{
	const data: import("./data.json", { with: { type: "json" } }).Data = load();
	<div>{data.name}</div>
}