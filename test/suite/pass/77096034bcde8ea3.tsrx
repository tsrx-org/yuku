export function App({ items }: { items: string[] }) @{
				<>
					<h3>head</h3>
					<p>text</p>
					@for (const item of items) {
						<div>{item}</div>
					}
				</>
			}