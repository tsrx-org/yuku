function App({ items }) @{
	<div>
		{...items}
		<>{...items}</>
		<Card content={<i>{...items}</i>} />
		@if (items.length) {
			<b>{...items}</b>
		}
	</div>
}
function List({ items }) {
	return <ul>{...items}</ul>;
}