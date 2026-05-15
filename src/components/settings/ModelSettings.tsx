import { Dropdown, type DropdownOption } from "../ui/Dropdown";
import { useSettingsStore } from "../../stores/settingsStore";
import type { AiModel } from "../../types";
import type { ReactNode } from "react";

const MODEL_OPTIONS: DropdownOption<AiModel>[] = [
  { value: "nano-banana-2", label: "Nano Banana 2", description: "Google Gemini — szybki, dobra jakość" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", description: "Google Gemini — wyższa jakość, wolniejszy" },
  { value: "gpt-image-2", label: "GPT Image 2", description: "OpenAI — obsługuje maski (inpainting)" },
];

interface SettingRowProps {
  label: string;
  description: string;
  children: ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-gray-800 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200 font-medium">{label}</p>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed">{description}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

export function ModelSettings() {
  const { editTextModel, changeAngleModel, setEditTextModel, setChangeAngleModel } =
    useSettingsStore();

  return (
    <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-100">Modele AI</h2>
        <p className="text-xs text-gray-500 mt-1">
          Wybierz domyślny model dla każdej operacji. Modele do generowania nowych wizualizacji
          wybierasz osobno w panelu generowania.
        </p>
      </div>

      <div className="bg-[#1a1a1a] rounded-lg px-5">
        <SettingRow
          label="Edycja wizualizacji"
          description={`Model używany w modalu „Edytuj wizualizację" — zarówno do edycji tekstowej, jak i z zaznaczeniem pędzlem. GPT Image 2 używa natywnej maski w API. Modele Google (Nano Banana 2 / Pro) nie mają masek w API, więc zaznaczenie jest wpalane w obraz jako wizualny marker (półprzezroczysty czerwony obszar) z odpowiednią instrukcją w prompcie.`}
        >
          <Dropdown<AiModel> value={editTextModel} options={MODEL_OPTIONS} onChange={setEditTextModel} />
        </SettingRow>

        <SettingRow
          label="Zmiana kąta kamery"
          description={`Model używany w modalu „Zmień kąt" — widget 3D buduje prompt opisujący nową perspektywę, model regeneruje obraz z tego kąta.`}
        >
          <Dropdown<AiModel>
            value={changeAngleModel}
            options={MODEL_OPTIONS}
            onChange={setChangeAngleModel}
          />
        </SettingRow>
      </div>
    </div>
  );
}
