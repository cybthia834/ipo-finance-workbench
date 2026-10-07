"""One-time empty-environment identity administrator provisioning; secrets use an interactive prompt."""
from getpass import getpass
from sqlalchemy import select
from . import models as m
from .common import audit, lock_project
from .db import SessionLocal
from .security import hasher


def main():
    username = input('首位身份管理员账号：').strip()
    display_name = input('人员显示名称：').strip()
    person_id = input('唯一人员编号：').strip()
    password = getpass('临时密码（至少12位）：')
    from .schemas import UserCreate
    body = UserCreate(username=username, display_name=display_name, person_id=person_id, password=password)
    with SessionLocal.begin() as db:
        lock_project(db, 'identity-account-limit')
        if db.scalar(select(m.User.id).limit(1)):
            raise RuntimeError('已有账号，拒绝重复初始化；请通过现有身份管理员操作。')
        user = m.User(**body.model_dump(exclude={'password'}), password_hash=hasher.hash(password), identity_admin=True)
        db.add(user); db.flush(); audit(db, user, user.id, 'initial_admin_provisioned')
    print('首位账号已创建，首次登录必须更改密码。未授予已有项目业务权限。')


if __name__ == '__main__': main()
