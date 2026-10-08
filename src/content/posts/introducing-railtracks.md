---
title: 'Railtracks: build your own agent harness in plain Python'
summary: Railtracks is the open-source agent framework I designed at Railtown AI. Every part of an agent is an ordinary Python object you can read, debug and replace, from the loop to the record of each run.
published: 2026-09-30
tags: [agents, open-source, framework]
image: /og/introducing-railtracks.png
---

Most agent frameworks are easy to start with and hard to live with. The first demo takes ten minutes. Then something goes wrong in production, and you find yourself reading the framework's source to learn what it did on your behalf.

Railtracks is the framework I designed and built at Railtown AI to avoid that second part. It is open source under the MIT license, it runs on Python 3.10 and later, and its whole premise fits in one sentence: every piece of an agent is an ordinary Python object that you assemble yourself.

## The short version

- **Plain Python.** No YAML, no DSL, no runtime you cannot step into. Branching and looping are `if` and `for`.
- **Any function is a tool.** Decorate it, and its signature and docstring become the tool definition.
- **Built around the harness**, the part of an agent that stays yours when you change the model.
- **Controls are objects.** Call budgets, timeouts, retries and human approval are things you attach to a node, not settings buried in a config file.
- **Every run is recorded** and can be replayed locally, with no account and nothing sent anywhere.

## What it looks like

A tool is a function. An agent is a model, a system message and a list of tools. A flow runs it.

```python
import railtracks as rt


@rt.function_node
def word_count(text: str) -> int:
    """Count words in text."""
    return len(text.split())


TextAnalyzer = rt.agent_node(
    "Text Analyzer",
    tool_nodes=[word_count],
    llm=rt.llm.OpenAILLM("gpt-6-luna"),
    system_message="You analyze text using the available tools.",
)

flow = rt.Flow(name="Text Analysis", entry_point=TextAnalyzer)
result = flow.invoke("How many words are in 'the quick brown fox'?")
print(result.content)
```

There is nothing else to configure. Your editor autocompletes it, your type checker checks it, and when it misbehaves you set a breakpoint in `word_count` like you would anywhere else. The same code runs against OpenAI, Anthropic, Google, Azure or a local model through Ollama by swapping the `llm` line.

## Own the harness

The model brings judgment. Everything around it is the **harness**: the loop that keeps calling the model, the tools it can reach, what lands in its context, the limits on what it may do, and the record of what it did. Models change every few months. The harness is what you keep, so it is the part a framework should hand to you rather than hide.

Railtracks splits the harness into five parts. You take the ones your problem needs and leave the rest out.

| Part         | What it decides                                 | In Railtracks                                                       |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------- |
| Loop         | When the agent keeps going, and when it is done | `rt.agent_node` runs the tool-calling loop; `rt.Flow` and `rt.call` |
| Tool surface | What the agent can actually do                  | `rt.function_node`, agents as tools, `rt.connect_mcp` for MCP       |
| Context      | What the model sees on this turn                | System message, `rt.context`, memory toolsets, retrieval            |
| Controls     | What it is allowed to do, and how much          | `MaxCalls`, `Timeout`, `Retry`, `Lock`, human approval, guardrails  |
| Record       | What happened, and whether you can replay it    | Session state, `railtracks viz`, `rt.evaluations.evaluate`          |

A coding harness, for example, is file and shell tools, a todo list that survives across turns, and human approval on anything that touches the working tree. An operations harness is a few high-consequence tools, each behind a real approver, with an audit trail you can hand to someone else. Both are the same five parts, wired differently.

## Controls you can see

A common way for a production agent to fail is not a wrong answer. It is an agent that keeps going: one more tool call, one more retry, until it hits a rate limit or a bill. In Railtracks a budget is a line of code next to the agent it governs:

```python
from railtracks.prebuilt.middleware import MaxCalls, Timeout

RepoReader = rt.agent_node(
    name="Repo Reader",
    llm=rt.llm.OpenAILLM("gpt-6-luna"),
    tool_nodes=[list_files, read_file, find_files],
    middleware=[Timeout(300)],
    model_middleware=[MaxCalls(20)],
)
```

Twenty model calls and five minutes, then it stops, every run. Anyone reading the code can see the limit without opening a config file or a dashboard.

## The record

Agents fail in ways a stack trace does not explain. The model chose the wrong tool, or the right tool with the wrong argument, or it stopped one step early. So Railtracks records each run by default, and `railtracks viz` opens a local visualizer that replays it: every node, every model call, every tool result, in order. It runs on your machine with no sign-up.

The same record feeds evaluation. `rt.evaluations.evaluate` scores runs, so the question "did this change make the agent better?" gets a number instead of an impression. An agent you cannot measure is an agent you cannot safely change.

## When not to use it

If you want a hosted product where agents are configured in a web form, this is the wrong tool. Railtracks assumes you are comfortable writing Python and want to own the code. It also does not run in a browser today: a few of its dependencies have no WebAssembly build yet, which is why the [Python runner](/tools/python-runner) on this site can only attempt the install and show you the code.

## Try it

```bash
pip install 'railtracks[visual]'
echo "OPENAI_API_KEY=sk-..." >> .env
```

Then copy the example above and run it. If you write code with Claude Code, the repository ships a plugin so the assistant writes Railtracks code correctly:

```bash
claude plugin marketplace add RailtownAI/railtracks
claude plugin install railtracks@railtracks
```

The code, the examples and the issue tracker are on [GitHub](https://github.com/RailtownAI/railtracks), and the guides, including the agent harness walkthrough, are at [docs.railtracks.org](https://docs.railtracks.org/). The `examples/harness` folder is the fastest way in: a read-only harness in under 80 lines, and a coding harness whose file writes and shell commands each stop for your approval.

_Railtracks is developed in the open by the team at Railtown AI. Issues and pull requests are welcome._
