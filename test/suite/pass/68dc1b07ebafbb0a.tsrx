export function App({ items, more }: { items: any[]; more: any[] }) @{
	<div>
		{...items}
		text
		{...more.map((item) => <b>{item}</b>)}
		<span />
	</div>
}