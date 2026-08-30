window.__ModuleLoader__.load({
	id: "dsh-tokcnt",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		var React = require("react");

		const inject = ["slots"];

		function apply(ctx) {
			const slots = ctx.slots;
			if (slots === undefined) return;

			const CSS =
				'.tokcnt-tail{display:flex;align-items:center}' +
				'.tokcnt-badge{' +
				'font-size:11px;line-height:18px;' +
				'color:var(--dsw-alias-label-secondary);' +
				'background:var(--dsw-alias-bg-layer-1);' +
				'border:1px solid var(--dsw-alias-border-l1);' +
				'border-radius:999px;padding:0 8px;' +
				'font-variant-numeric:tabular-nums;white-space:nowrap;user-select:none' +
				'}' +
				'.tokcnt-badge b{color:var(--dsw-alias-label-primary);font-weight:600}' +
				'.tokcnt-sep{opacity:.5;margin:0 4px}' +
				'.tokcnt-acc{color:var(--dsw-alias-label-secondary)}';

			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.textContent = CSS;
				document.head.append(tag);
				return () => tag.remove();
			}, "dsh-tokcnt: styles");

			function formatTokens(n) {
				if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "0";
				if (n < 1000) return String(Math.round(n));
				const scaled = (v) => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
				if (n < 1000000) return scaled(n / 1000) + "K";
				return scaled(n / 1000000) + "M";
			}

			function TokenCountTail(props) {
				const turn = props.turn;
				const useSession = props.useSession;
				const useProjection = props.useProjection;
				if (turn === undefined || useSession === undefined) return null;

				const nodes = useSession((s) => s.nodes);
				const usage = useProjection === undefined ? undefined : useProjection("tokenUsage");
				const turnNumber = turn.turn;

				let input = 0;
				let output = 0;
				let cacheRead = 0;
				let cacheWrite = 0;

				for (const node of nodes) {
					if (node.kind !== "assistant" || node.turn !== turnNumber) continue;
					const u = node.usage;
					if (u === null || typeof u !== "object") continue;
					input += typeof u.inputTokens === "number" && u.inputTokens >= 0 ? u.inputTokens : 0;
					output += typeof u.outputTokens === "number" && u.outputTokens >= 0 ? u.outputTokens : 0;
					cacheRead += typeof u.cacheReadTokens === "number" && u.cacheReadTokens >= 0 ? u.cacheReadTokens : 0;
					cacheWrite += typeof u.cacheWriteTokens === "number" && u.cacheWriteTokens >= 0 ? u.cacheWriteTokens : 0;
				}

				let cumulative = 0;
				if (usage !== undefined && usage !== null && typeof usage === "object") {
					cumulative = (typeof usage.uncachedInputTokens === "number" ? usage.uncachedInputTokens : 0)
						+ (typeof usage.outputTokens === "number" ? usage.outputTokens : 0)
						+ (typeof usage.cacheReadTokens === "number" ? usage.cacheReadTokens : 0)
						+ (typeof usage.cacheWriteTokens === "number" ? usage.cacheWriteTokens : 0);
				}

				if (output === 0 && cumulative === 0) return null;

				const cache = cacheRead + cacheWrite;
				const turnDetail = ["输入 " + formatTokens(input), "输出 " + formatTokens(output)];
				if (cache > 0) turnDetail.push("缓存 " + formatTokens(cache));
				const lines = [];
				if (output > 0) lines.push("本轮：" + turnDetail.join(" · "));
				if (cumulative > 0) lines.push("会话累计：" + formatTokens(cumulative) + " tokens");
				const title = lines.join("\n");

				const children = [];
				if (output > 0) {
					children.push(React.createElement("b", null, "输出 " + formatTokens(output)));
				}
				if (output > 0 && cumulative > 0) {
					children.push(React.createElement("span", { className: "tokcnt-sep", key: "sep" }, "·"));
				}
				if (cumulative > 0) {
					children.push(React.createElement("span", { className: "tokcnt-acc", key: "acc" }, "累计 " + formatTokens(cumulative)));
				}

				return React.createElement("div", {
					className: "tokcnt-tail",
					title
				}, React.createElement("span", {
					className: "tokcnt-badge"
				}, children, " tokens"));
			}

			slots.inject("conversation.chat.turnTail", () => slots.register(
				{ name: "conversation.chat.turnTail", select: (owner) => owner.turn.turn },
				TokenCountTail
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
