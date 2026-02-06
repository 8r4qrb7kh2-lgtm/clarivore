import { myDishesMarkup } from "../myDishesMarkup";

export default function MyDishesDom() {
  return (
    <div
      className="page-shell"
      dangerouslySetInnerHTML={{ __html: myDishesMarkup }}
    />
  );
}

