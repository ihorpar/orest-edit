import { Annotation, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";

export function createBaseEditorExtensions(input: {
  onUpdate: Extension;
  onPasteImage: Extension;
  onFocusChange: Extension;
}) {
  return [
    EditorView.lineWrapping,
    history(),
    markdown(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...markdownKeymap, indentWithTab]),
    EditorView.contentAttributes.of({
      spellcheck: "false",
      autocorrect: "off",
      autocomplete: "off",
      autocapitalize: "off",
      "aria-label": "Редактор рукопису"
    }),
    EditorView.editorAttributes.of({
      class: "orest-cm-editor"
    }),
    input.onUpdate,
    input.onPasteImage,
    input.onFocusChange
  ];
}

export function createEditorCompartments() {
  return {
    chrome: new Compartment(),
    editable: new Compartment()
  };
}

export function createEditableExtension(isEditable: boolean) {
  return EditorView.editable.of(isEditable);
}

export function createExternalAnnotation<T>() {
  return Annotation.define<T>();
}
