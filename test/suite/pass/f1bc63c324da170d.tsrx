function App() {
				return <Item title="Root">{[<Item key="c1">A</Item>, <Item key="c2">B</Item>] as any}</Item>;
			}