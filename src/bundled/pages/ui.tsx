import { createContext, useContext } from "react";
import type { Context } from "../../plugins/author";

type PagesUi = {
  conversation: Context["conversation"]["ui"];
  panels: Context["panels"]["ui"];
};

const Ui = createContext<PagesUi | undefined>(undefined);
export const PagesUiProvider = Ui.Provider;
export function usePagesUi() {
  const ui = useContext(Ui);
  if (!ui) throw new Error("Pages requires its host UI provider.");
  return ui;
}
