export function App({ rows }) {
				return <table>
					{rows.map((row) => <tr>@{
						const cells = row.cells;
						@for (const cell of cells) { <td>{cell}</td> }
					}</tr>)}
				</table>;
			}