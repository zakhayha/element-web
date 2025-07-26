/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import classNames from "classnames";
import React, { type JSX, useState } from "react";

import { _t } from "../../../languageHandler";
import { CollapsibleButton } from "./CollapsibleButton";

interface IAIToggleButtonProps {
    className?: string;
}

export function AIToggleButton({ className }: IAIToggleButtonProps): JSX.Element {
    const [isAIEnabled, setIsAIEnabled] = useState(false);

    const handleToggle = (): void => {
        setIsAIEnabled(!isAIEnabled);
    };

    const computedClassName = classNames("mx_AIToggleButton", className, {
        mx_AIToggleButton_enabled: isAIEnabled,
    });

    const tooltipText = isAIEnabled ? _t("common|toggle_ai_off") : _t("common|toggle_ai_on");

    return (
        <CollapsibleButton
            className={computedClassName}
            iconClassName="mx_AIToggleButton_icon"
            onClick={handleToggle}
            title={tooltipText}
        >
            AI
        </CollapsibleButton>
    );
}
