export function Table() {
	const state = useTableState({
		children: [
			<TableHeader
				key="head"
				columns={columns}
				children={
					((c: any) => (
						<Column key={c.id} isRowHeader={c.isRowHeader}>
							{c.name}
						</Column>
					)) as any
				}
			/>,
		] as any,
		selectionMode: 'multiple',
	});
	return <div>{state.collection.size}</div>;
}