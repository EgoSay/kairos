package memoreference

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/EgoSay/kairos/markdown"
)

func TestTargetsRespectMarkdownAndOrigin(t *testing.T) {
	parser := markdown.NewService()
	for _, test := range []struct {
		name, content string
		want          []string
	}{
		{"bare", "https://journal.example/memos/one?view=full#section", []string{"one"}},
		{"duplicates and custom text", "[旧想法](/memos/one)\n\nhttps://journal.example/memos/one\n\n<https://journal.example/memos/two/>", []string{"one", "two"}},
		{"reference syntax", "[旧想法][record]\n\n[record]: /memos/one", []string{"one"}},
		{"literal code", "`https://journal.example/memos/one`\n\n```\nhttps://journal.example/memos/two\n```", nil},
		{"images and escaped", "![image](/memos/one)\n\n\\[label](/memos/two)", nil},
		{"foreign and invalid", "https://journal.example.evil/memos/one\n\n[bad](https://user:pass@journal.example/memos/two)\n\n[bad](/memos/a%2fb)\n\n[bad](//foreign.example/memos/three)", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := Targets(test.content, "https://journal.example", parser)
			require.NoError(t, err)
			require.Equal(t, test.want, got)
		})
	}
}
