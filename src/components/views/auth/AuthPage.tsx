/*
Copyright 2019-2024 New Vector Ltd.
Copyright 2019 The Matrix.org Foundation C.I.C.
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";


export default class AuthPage extends React.PureComponent<React.PropsWithChildren> {

    // cache the url as a static to prevent it changing without refreshing
    // private static getWelcomeBackgroundUrl(): string {
    //     if (AuthPage.welcomeBackgroundUrl) return AuthPage.welcomeBackgroundUrl;
    //
    //     const brandingConfig = SdkConfig.getObject("branding");
    //     AuthPage.welcomeBackgroundUrl = "themes/element/img/backgrounds/lake.jpg";
    //
    //     const configuredUrl = brandingConfig?.get("welcome_background_url");
    //     if (configuredUrl) {
    //         if (Array.isArray(configuredUrl)) {
    //             const index = Math.floor(Math.random() * configuredUrl.length);
    //             AuthPage.welcomeBackgroundUrl = configuredUrl[index];
    //         } else {
    //             AuthPage.welcomeBackgroundUrl = configuredUrl;
    //         }
    //     }
    //
    //     return AuthPage.welcomeBackgroundUrl;
    // }

    public render(): React.ReactElement {
        const pageStyle = {
            background: `#1F2937`,
        };
        const imageStyleLogin: React.CSSProperties = {
            width: "350px",
            marginBottom: "30px",

        };
        const signIn: React.CSSProperties = {
            display: "flex",
            zIndex: 1,
            alignItems: "center",
            justifyContent: "center",
        };
        const modalStyle: React.CSSProperties = {
            position: "relative",
            background: "initial",
        };

        // const blurStyle: React.CSSProperties = {
        //     position: "absolute",
        //     top: 0,
        //     right: 0,
        //     bottom: 0,
        //     left: 0,
        //     filter: "blur(40px)",
        //     background: pageStyle.background,
        // };

        // const modalContentStyle: React.CSSProperties = {
        //     display: "flex",
        //     zIndex: 1,
        //     background: "rgba(255, 255, 255, 0.59)",
        //     borderRadius: "8px",
        // };

        return (
            <div className="mx_AuthPage" style={pageStyle}>
                <div className="mx_AuthPage_modal" style={modalStyle}>
                    {/*<div className="mx_AuthPage_modalBlur" style={blurStyle} />*/}
                    <div className="mx_AuthPage_modalContent" style={modalStyle}>
                        <div style={signIn}>
                            {/* eslint-disable-next-line jsx-a11y/alt-text */}
                            <img src='/vector-icons/2.svg' style={imageStyleLogin} />
                        </div>
                        {this.props.children}
                    </div>
                </div>
                {/*<AuthFooter />*/}
            </div>
        );
    }
}
