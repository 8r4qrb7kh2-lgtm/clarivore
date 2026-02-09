import { helpContactMarkup } from "../helpContactMarkup";

export default function HelpContactDom() {
  return (
    <div
      className="page-shell"
      dangerouslySetInnerHTML={{ __html: helpContactMarkup }}
    />
  );
}
