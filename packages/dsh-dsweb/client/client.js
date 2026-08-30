window.__ModuleLoader__.load({
	id: "dsh-dsweb",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");

		const inject = ["slots"];

		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined) return;

			const CSS =
				'.dsweb-button{' +
				'display:inline-flex;align-items:center;gap:6px;' +
				'height:32px;padding:0 6px;margin:0 2px;border:none;background:transparent;' +
				'border-radius:8px;cursor:pointer;white-space:nowrap;user-select:none;overflow:hidden;' +
				'font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)' +
				'}' +
				'.dsweb-button:hover{' +
				'color:var(--dsw-alias-label-primary);' +
				'background:var(--dsw-alias-interactive-bg-hover)' +
				'}' +
				'.dsweb-button:active{' +
				'background:var(--dsw-alias-interactive-bg-active)' +
				'}' +
				'.dsweb-button[data-wide="false"]{width:36px;height:36px;padding:0;justify-content:center;flex:none}' +
				'.dsweb-button[data-wide="true"]{flex:1 1 0;min-width:0;justify-content:center}' +
				'.dsweb-icon{font-size:14px;line-height:1;display:inline-flex;flex:none}' +
				'.dsweb-label{font:inherit;min-width:0;overflow:hidden;text-overflow:ellipsis}';

			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.textContent = CSS;
				document.head.append(tag);
				return () => tag.remove();
			}, "dsh-dsweb: styles");

			function DsWebButton(props) {
				const wide = props.wide === true;
				const onClick = () => window.open("https://chat.deepseek.com", "_blank", "noopener");
				const children = [React.createElement("span", { className: "dsweb-icon", key: "icon" }, "🐋")];
				if (wide) {
					children.push(React.createElement("span", { className: "dsweb-label", key: "label" }, "网页"));
				}
				return React.createElement("button", {
					type: "button",
					title: "打开 DeepSeek 网页版（免费）",
					"data-wide": wide ? "true" : "false",
					className: "dsweb-button",
					onClick
				}, children);
			}

			slots.inject("sidebar.footer.action", () => slots.register(
				{ name: "sidebar.footer.action", id: "dsweb-open", order: 0 },
				DsWebButton
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});