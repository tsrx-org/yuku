export default function App() @{
	const items: string[] = [];
	<ul>
		@for (const i of items; key i) { <li>{i}</li> } @empty { <li>x</li> }
	</ul>
}
