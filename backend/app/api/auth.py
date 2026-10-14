from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .. import security
from ..config import get_config

router = APIRouter(prefix="/api/auth")


class PasswordIn(BaseModel):
    password: str


class ChangePasswordIn(BaseModel):
    current: str
    new: str


def _set_cookie(response: Response) -> None:
    response.set_cookie(
        security.COOKIE_NAME, security.make_session(), max_age=security.SESSION_MAX_AGE, httponly=True,
        samesite="lax", secure=get_config().cookie_secure,
    )


@router.get("/status")
def status(request: Request) -> dict:
    return {
        "password_set": security.password_is_set(),
        "managed_by_env": bool(get_config().app_password),
        "signed_in": security.session_valid(request.cookies.get(security.COOKIE_NAME)),
    }


@router.post("/setup")
def setup(body: PasswordIn, response: Response) -> dict:
    if security.password_is_set():
        raise HTTPException(409, "A password is already set.")
    security.set_password(body.password)
    _set_cookie(response)
    return {"ok": True}


@router.post("/login")
def login(body: PasswordIn, request: Request, response: Response) -> dict:
    client = request.client.host if request.client else "unknown"
    security.login_limiter.check(client)
    if not security.check_password(body.password):
        security.login_limiter.fail(client)
        raise HTTPException(401, "Wrong password.")
    _set_cookie(response)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(security.COOKIE_NAME)
    return {"ok": True}


@router.post("/password", dependencies=[Depends(security.require_session)])
def change_password(body: ChangePasswordIn, response: Response) -> dict:
    if get_config().app_password:
        raise HTTPException(409, "The password is set by APP_PASSWORD on the server; change it there.")
    if not security.check_password(body.current):
        raise HTTPException(401, "The current password is wrong.")
    security.set_password(body.new)
    _set_cookie(response)
    return {"ok": True}
