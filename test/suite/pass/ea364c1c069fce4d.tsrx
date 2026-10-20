class C {
	#p = {};
	render() @{
		<main>
			<div {...this.#p} />
		</main>
	}
}